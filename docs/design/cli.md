---
title: cli
target-version: 0.6.3
---

# Wafflebase CLI

## Summary

`wafflebase` is a TypeScript CLI that wraps the REST API
([rest-api.md](rest-api.md)) for terminal workflows: data pipelines,
scripting, CSV/JSON import/export, Markdown / PDF / DOCX of Docs
documents, and document management. It ships as `@wafflebase/cli`
inside the pnpm monorepo so it can import `@wafflebase/docs` and
`@wafflebase/sheets` directly and share their types.

Authentication is via browser-based GitHub OAuth (`wafflebase login`),
which stores a JWT session in `~/.wafflebase/session.json`, or via a
workspace-scoped API key (`Authorization: Bearer wfb_...`). Users with
multiple workspaces switch with `wafflebase ctx switch`.

The CLI is designed as a first-class tool for AI agents (Claude Code,
Gemini CLI, Cursor): JSON-by-default output, JSON error envelopes,
`--dry-run`, runtime schema introspection (`wafflebase schema`),
per-command safety annotations, and bundled skill / recipe Markdown
files.

### Goals

- Let users authenticate the CLI by signing in with GitHub in the
  browser; store JWT sessions locally with automatic token refresh.
- Maintain backwards compatibility with API key authentication for
  CI and headless environments.
- Support workspace context switching for users with multiple
  workspaces.
- Provide CRUD-grade access to Docs and Sheets documents from the
  terminal: list, create, get, rename, delete metadata.
- For Sheets: read/write cells, batch updates, CSV/JSON import-export.
- For Docs: read content as JSON/Markdown/text, export to DOCX/PDF,
  import a DOCX as either a new document or a destructive replacement
  of an existing document. Page-based slicing (`--pages 1-3,5`) is a
  first-class concept for content read and PDF export.
- For Files: upload any file as a blob document and download its bytes
  back, so a workspace is reachable as a general-purpose store from the
  terminal — not only through the browser's documents list.
- Symmetric plural namespaces (`docs`, `sheets`, `api-keys`) with
  singular aliases for ergonomics.
- Make the CLI first-class for AI agent consumption: structured
  output, self-describing schema, dry-run support, and bundled skill
  definitions.
- Avoid heavy native dependencies (no `node-canvas`-style native
  build) by abstracting text measurement and reusing the existing
  `fontkit` fonts.

### Non-Goals

- Multiple GitHub account switching (single account, multiple
  workspaces).
- Device flow or headless authentication (may be added later).
- Encrypting stored tokens (file permissions are sufficient for now;
  matches `gh`, `supabase` CLIs).
- Block-level write or patch on Docs (`docs blocks set/append/delete`).
  Only whole-document replace via DOCX import is in scope.
- Section/heading-based or block-index-based slicing — only page-based
  slicing is supported in v1.
- Server-side serialization or rendering of Docs. The backend serves
  only raw `Document` JSON; Markdown/text/PDF/DOCX are produced by the
  CLI.
- A separate `waffledocs` binary or a separate npm package for the
  Docs CLI.
- Image upload during DOCX import (v1 imports embed inline images via
  the existing `ImageUploader` interface in `DocxImporter`).
- Streaming or resumable file upload, and replacing a blob in place
  (`files upload --replace`). Uploads stay buffered under the existing
  50 MB cap; presigned direct-to-S3 remains the documented next step in
  [generic-file-upload.md](generic-file-upload.md).
- Real-time streaming or Yorkie-attached read/write from the CLI.

## Proposal Details

### 1. Technology and Distribution

- **Language**: TypeScript (same toolchain as the rest of the
  monorepo).
- **CLI framework**: [commander](https://github.com/tj/commander.js)
  (lightweight, subcommand support).
- **HTTP client**: [undici](https://github.com/nodejs/undici) — a direct
  dependency rather than the runtime's built-in `fetch`. The export image
  gate pins each request to the addresses it approved by handing the
  request an undici `Agent`, and only the matching implementation is
  guaranteed to honor a userland dispatcher (see §_Export image
  fetching_). Requiring undici's own version is what makes the pin a
  property of the CLI instead of of whatever `fetch` the host runtime
  ships; it also sets the floor in `engines.node` (`>=20.18.1`, undici
  7's own minimum).
- **Output formats**: JSON (default), table (`--format table`), CSV
  (`--format csv`), YAML (`--format yaml`).
- **Config file format**: [yaml](https://www.npmjs.com/package/yaml).
- **Distribution**: `npx @wafflebase/cli`, `npm install -g
  @wafflebase/cli`, or `pnpm dlx @wafflebase/cli`.

JSON is the default output format because agents and scripts are the
primary consumers. Human users can switch to `--format table` for
readability.

**Why TypeScript over Go**:

- Shares types with `@wafflebase/sheets` and `@wafflebase/docs` — no
  duplication of `Cell`, `Sref`, `CellStyle`, `SpreadsheetDocument`,
  `Document`, `Block`.
- Single toolchain — no separate Go compiler, linter, or CI pipeline.
- AI agent environments (Claude Code, Cursor) already have Node.js.
- Can be converted to a standalone binary later via `bun build --compile`
  if single-binary distribution becomes important.

### 2. Directory Structure and Configuration

All CLI state lives under `~/.wafflebase/`:

```text
~/.wafflebase/
├── config.yaml        # Profile settings (server, API key, workspace)
├── session.json       # OAuth session (JWT tokens + active workspace)
└── login-url.txt      # Transient: the login URL when stderr is not a TTY,
                       # written 0600 and deleted when the login settles
```

**Migration:** if `~/.wafflebase/config.yaml` does not exist but
`~/.config/wafflebase/config.yaml` does, the CLI copies the file to
`~/.wafflebase/config.yaml` automatically and prints a notice. After
migration, only `~/.wafflebase/` is consulted.

**Config file** (config.yaml) — profiles selected with `--profile`
(default `default`):

```yaml
profiles:
  default:
    server: https://app.wafflebase.io
    api-key: wfb_xxxxx
    workspace: ws-uuid-here
  local:
    server: http://localhost:3000
    api-key: wfb_yyyyy
    workspace: ws-uuid-here
```

**Session file** (session.json) — written `0600`, owner read/write only:

```json
{
  "server": "http://localhost:3000",
  "user": {
    "id": 1,
    "username": "alice",
    "email": "alice@example.com",
    "photo": "https://avatars.githubusercontent.com/u/..."
  },
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "expiresAt": "2026-03-15T10:00:00Z",
  "activeWorkspace": "e98ff707-a0e8-473e-88a1-37c0b5bb88da",
  "workspaces": [
    { "id": "e98ff707-...", "name": "hackerwins's Workspace" },
    { "id": "abc-123-...",  "name": "Team Workspace" }
  ]
}
```

`expiresAt` is derived by decoding the JWT payload (base64) and reading
the `exp` claim, converted to ISO 8601.

### 3. Authentication

The CLI supports two authentication paths. OAuth is the default for
developers; API keys are the path for CI and headless environments.

#### 3.1 Login flow (OAuth)

```text
wafflebase login
  │
  ├─ 1. If already logged in → prompt "Logged in as X. Continue? [Y/n]"
  ├─ 2. CLI starts temporary HTTP server on 127.0.0.1:<random-port>,
  │     generates a per-attempt nonce (32 random bytes, hex) and a PKCE
  │     verifier (32 random bytes, base64url) it keeps in memory
  ├─ 3. Opens browser at http://127.0.0.1:<port>/launch/<token>, a
  │     single-use loopback redirect to
  │       GET /auth/github?mode=cli&port=<port>&nonce=<nonce>
  │         &challenge=<sha256(verifier), base64url>
  │     (the authorization URL itself never goes into a child process's
  │      argv; it is announced separately for copy-paste — see below)
  ├─ 3b. Backend answers with a confirmation page; the user clicks
  │     Continue (one-time secret + httpOnly cookie) → OAuth starts
  ├─ 4. GitHub OAuth consent screen (existing flow)
  ├─ 5. GitHub redirects to GET /auth/github/callback
  ├─ 6. Backend detects mode=cli in OAuth state →
  │     redirects to http://127.0.0.1:<port>/callback
  │       ?code=<short-lived-code>&state=<nonce>
  ├─ 7. CLI local server receives code, calls POST /auth/cli/exchange
  │     with { code, verifier } → receives { accessToken, refreshToken }
  │     (the code alone buys nothing: it arrives over plaintext loopback
  │      HTTP, so redemption also needs the verifier, which never left
  │      the CLI process)
  ├─ 8. CLI local server serves success HTML, shuts down
  ├─ 9. CLI calls GET /auth/me (Bearer token) for user info
  ├─ 10. CLI calls GET /workspaces (Bearer token) for workspace list
  ├─ 11. Multiple workspaces → interactive selection; single → auto-select
  └─ 12. Writes ~/.wafflebase/session.json
```

The local server binds to `127.0.0.1` only, accepts only `GET /callback`
and the single-use `GET /launch/<token>` redirect that starts the login, and
shuts down after a single accepted callback with a five-minute timeout. On
timeout it prints: "Login timed out. Try again with `wafflebase login`.",
followed by the last refusal when there was one.

Five minutes, not thirty seconds, because the browser leg is no longer
GitHub's consent screen alone: the server stops a CLI start on an
interstitial naming the loopback port (step 3b) and waits for a deliberate
click, and on a cold browser a full GitHub sign-in follows. Five minutes is
also the server's own budget for one login (the CLI state cookie and the
`CliAuthStore` state entry), so the two ends expire together instead of the
CLI abandoning logins the server still holds open.

**The authorization URL never reaches argv or a log.** It carries this
login's nonce and PKCE challenge, so an observer of it can start their own
login under the same pair and push the resulting code at the port. Opening a
URL puts it in a child process's argv, which any local user can read (`ps`,
`/proc/<pid>/cmdline`) on exactly the shared host these bindings are for, so
`open()` is handed `http://127.0.0.1:<port>/launch/<32-byte token>` instead;
it redirects once and is then spent. A second visit answers `410` with a page
saying the link was already used and to re-run `wafflebase login` — the link
goes to an arbitrary system opener, so a prefetch or a link scanner can win
the race, and a bare 404 left the person nothing to act on but the timeout.
It never re-offers the authorization URL, and a token that is not this
login's stays a bare `404`. `open()` resolving is not evidence a browser
appeared — it only means the child was spawned — so the URL is announced
either way, through whichever channel is safe: stderr when it is a terminal
(the only reader is the person logging in), and otherwise a `login-url.txt`
beside the config file, written `0600` and deleted as soon as the login
settles. Server-side, the access log redacts `/auth` query strings for the
same reason (4xx there is logged at `warn`).

The callback is bound to the login attempt by the nonce: the CLI
accepts a `code` only when the request carries that nonce back as
`state` (compared in constant time), and refuses anything that is not a
plain `GET`. Without the binding, any page the user happens to visit
during the wait can hit
`http://127.0.0.1:<port>/callback?code=…` — the port space is small
enough to scan — and make the CLI exchange a code minted for the
attacker's account, silently writing a session for the wrong user
(login CSRF / session fixation). A forged hit is answered `403` and
does *not* end the wait, so the real redirect can still land. The nonce
round trip is a backend contract: the loopback redirect echoes it, so a
CLI at this version or later needs a backend at this version or later.

One check sits in front of the nonce: a request whose `Host` header is
not a loopback literal (`127.0.0.1`, `localhost`, `[::1]`) on this
listener's own port is refused. Binding to `127.0.0.1` limits *who* can
reach the listener to the local machine, but a name under an attacker's
control that resolves to `127.0.0.1` (DNS rebinding) still reaches it,
with the browser treating it as same-origin — and such a request carries
the attacker's name in `Host`. It is defence in depth, not a second
defense: a rebound page would still have to guess the nonce; this simply
stops it from reaching the check. A missing `Host` (HTTP/1.0) is allowed
— a browser always sends one.

Beyond that the nonce is the whole defense, deliberately. An earlier revision also
refused any request carrying an `Origin` header; a browser, extension
or proxy can attach one (`Origin: null` among them) to the cross-origin
redirect chain that *is* the genuine callback, and because a refusal
never ends the wait, refusing on it would hang the login for the full
timeout. A header no attacker is obliged to send adds nothing the nonce
does not already cover.

Because a refusal never ends the wait, it must not be silent either —
otherwise a CLI pointed at an older backend refuses its own genuine
redirect and hangs for the full timeout with nothing to act on.
Every refusal names its cause on stderr as it happens, answers the
browser tab with the same sentence, and is repeated in the timeout
error, distinguishing the three cases: no `state` at all (the server
does not echo the nonce — most likely older than the CLI), a `state`
that does not match (a callback that is not ours), and a non-GET
request. What no refusal ever does is *prescribe the downgrade below*:
that listener is reachable by exactly the adversary the nonce exists to
stop, so advice it can trigger is attacker-settable.

Because published CLIs and self-hosted backends upgrade on their own
schedules, `wafflebase login --allow-unbound-callback` accepts a
`state`-less callback anyway, so a current CLI can still log into a
server that has not deployed the echo. It is an explicit, warned
downgrade — never a silent fallback — and it covers only the
`state`-*absent* case; a *mismatched* `state` stays `403` under the
flag, since only an attacker sends one. It is documented in `wafflebase
login --help` and the CLI README, places an attacker has no say over
(see "Nonce-bound login callback" in §8.1).

The browser leg is gated on a click. `GET /auth/github?mode=cli&port=…`
is unauthenticated and takes the loopback port off the query string, so
on a bare navigation it would mint an auth code **for whoever is signed
in to the browser** and post it to a port the caller chose — a page the
victim visits can start that, and the loopback nonce cannot help,
because the attacker picked the nonce. The backend therefore answers a
CLI login with a confirmation page (`X-Frame-Options: DENY`) whose
Continue link carries a one-time secret that also went out as an
httpOnly cookie; only a matching pair starts the OAuth redirect. An
attacker can navigate the victim to that page, but cannot read the
secret out of the victim's response, and a secret minted against their
own cookie will not match the victim's.

Tokens are NOT passed as URL query parameters. The short-lived
authorization code is exchanged server-to-server in step 7. CSRF and
port-validation details live in [rest-api.md](rest-api.md) "CLI Auth
Endpoints".

#### 3.2 API keys

Two ways to obtain a key:

**Path A: CLI (developers)**

```bash
wafflebase login                      # OAuth → JWT session
wafflebase api-keys create "CI Key"   # create key using JWT
# Use key in CI: WAFFLEBASE_API_KEY=wfb_xxx
```

**Path B: Web UI (all users)**

```text
1. Sign in at the web app (GitHub OAuth)
2. Navigate to Workspace Settings (/w/:workspaceId/settings)
3. API Keys section → Create → copy the one-time key
4. Use in CLI: wafflebase --api-key wfb_xxx docs list
   Or in config.yaml / environment variable
```

The web UI already supports API key create, list, copy, and revoke
(owner-only, at
`packages/frontend/src/app/workspaces/workspace-settings.tsx`).

#### 3.3 Auth resolution order

When the CLI authenticates a request, it checks sources in this order:

1. **Flag / env:** `--api-key` flag or `WAFFLEBASE_API_KEY` →
   `Authorization: Bearer wfb_...` (API key auth).
2. **Session:** `~/.wafflebase/session.json` exists and token is valid
   → `Authorization: Bearer <jwt>` (JWT auth). If expired, auto-refresh
   via `POST /auth/refresh` with body. If refresh fails, print error
   suggesting `wafflebase login`.
3. **Config profile:** `~/.wafflebase/config.yaml` profile has `api-key`
   → `Authorization: Bearer wfb_...` (API key auth).
4. **None:** error message with `Run "wafflebase login" to authenticate.`

**Workspace resolution:**

1. `--workspace` flag or `WAFFLEBASE_WORKSPACE` env.
2. Session → `activeWorkspace`.
3. Config profile → `workspace`.

A resolved workspace id is interpolated into the request path like any
other id, so it goes through the same one-segment encoding — and the same
refusal of a `.` / `..` id — described in §10.

#### 3.4 Token refresh

The CLI wraps HTTP requests with automatic refresh:

1. Make request with `Authorization: Bearer <accessToken>`.
2. If 401 response and session exists:
   - Call `POST /auth/refresh` with `{ refreshToken }` in body.
   - On success: update the session file with new tokens, retry
     original request.
   - On failure: print "Session expired. Run `wafflebase login`."
     and exit.
3. At most one refresh attempt per request (no infinite loops).

### 4. Command Tree

Plural namespaces are canonical (`docs`, `sheets`, `api-keys`).
Singular aliases (`doc`, `sheet`, `tab`, `cell`, `api-key`) work
everywhere they're unambiguous.

```text
wafflebase
  ├── login                                  Browser OAuth login → writes session
  ├── logout                                 Clear session
  ├── status                                 Show auth state
  ├── version                                Print CLI version
  ├── schema [<command>]                     Describe command parameters and response shape
  │
  ├── ctx
  │     ├── list                             List workspaces (`active: true` marks the current one)
  │     └── switch <name|id>                 Switch active workspace
  │
  ├── api-keys (alias: api-key)
  │     ├── create <name>                    Create a new API key
  │     ├── list                             List API keys in workspace
  │     └── revoke <key-id>                  Revoke an API key
  │
  ├── docs (aliases: doc, document, documents)
  │     ├── list                             [--type doc|sheet]
  │     ├── create <title>                   [--type doc|sheet] (default: sheet)
  │     ├── get <doc-id>                     Show document metadata
  │     ├── rename <doc-id> <title>          Rename a document
  │     ├── delete <doc-id>                  Delete a document
  │     ├── content <doc-id>
  │     │     [--format json|md|text]        (default: json)
  │     │     [--pages <range>]
  │     │     [--include-header-footer]      (default: false)
  │     │     [--inline-images]              (default: false; md only)
  │     │     [--out <file>|-]               (default: stdout)
  │     ├── export <doc-id> <file>
  │     │     [--format docx|pdf]            (default: from extension)
  │     │     [--pages <range>]              (pdf: exact subset; docx: warn+ignore)
  │     │     [--include-header-footer]      (default: true)
  │     │     [--force]                      (overwrite existing file)
  │     ├── import <file>
  │     │     [--title <title>]              (default: file basename)
  │     │     [--replace <doc-id> --yes]     (destructive; required together)
  │     │     [--workspace <id>]
  │     └── set-content <doc-id>             [--data <json>] (JSON from stdin or --data;
  │                                          destructive: replaces the whole content)
  │
  ├── sheets (aliases: sheet, spreadsheet, spreadsheets)
  │     ├── tabs (alias: tab)
  │     │     ├── list <doc-id>              List tabs in a spreadsheet
  │     │     ├── create <doc-id> [name]     Create a sheet tab (--type sheet)
  │     │     └── rename <doc-id> <tab-id> <name>   Rename a tab
  │     ├── cells (alias: cell)
  │     │     ├── get <doc-id> [<range>]     Get cells (default: all, or A1, or A1:C10)
  │     │     ├── set <doc-id> <ref> <value> [--tab] [--formula]
  │     │     ├── batch <doc-id>             [--tab] [--data <json>]   (JSON from stdin or --data)
  │     │     └── delete <doc-id> <ref>      [--tab]
  │     ├── import <doc-id> <file>
  │     │     [--tab <tab-id>] [--file-format csv|json] [--start <ref>]
  │     │     (--start places a positional grid; it is ignored for an
  │     │      exported `ref,value,formula` table, whose rows carry their
  │     │      own ref. The response's `mode` says which ran: cells|grid)
  │     ├── export <doc-id> <file>
  │     │     [--tab <tab-id>] [--range A1:C10] [--file-format csv|json]
  │     │     [--raw]   (CSV: write cell text verbatim, no formula guard,
  │     │                so `sheets import` round-trips formulas)
  │     ├── clear <doc-id>                   [--tab] [--data] — { "range": "A1:C10" }
  │     ├── insert <doc-id>                  [--tab] [--data] — { axis, index, count }
  │     ├── delete <doc-id>                  [--tab] [--data] — { axis, index, count }
  │     ├── move <doc-id>                    [--tab] [--data] —
  │     │                                    { axis, srcIndex, count, dstIndex }
  │     ├── styles (aliases: style, range-styles)      The range-style layer
  │     │     ├── get <doc-id>               [--tab]
  │     │     └── set <doc-id>               [--tab] [--data] — replaces the layer
  │     ├── sheet-style                                The one sheet-wide style
  │     │     ├── get <doc-id>               [--tab]
  │     │     └── set <doc-id>               [--tab] [--data] — merges; `null` clears
  │     ├── column-styles (alias: column-style)        Whole-column styles
  │     │     ├── get <doc-id>               [--tab]
  │     │     └── set <doc-id>               [--tab] [--data] — merges per index
  │     ├── row-styles (alias: row-style)              Whole-row styles
  │     │     ├── get <doc-id>               [--tab]
  │     │     └── set <doc-id>               [--tab] [--data] — merges per index
  │     ├── column-widths (alias: column-width)        Whole-column widths
  │     │     ├── get <doc-id>               [--tab]
  │     │     └── set <doc-id>               [--tab] [--data] — merges per index
  │     ├── row-heights (alias: row-height)            Whole-row heights
  │     │     ├── get <doc-id>               [--tab]
  │     │     └── set <doc-id>               [--tab] [--data] — merges per index
  │     ├── freeze                                     Frozen row/column counts
  │     │     ├── get <doc-id>               [--tab]
  │     │     └── set <doc-id>               [--tab] [--data] — { rows, cols }
  │     ├── hidden                                     Hidden row/column indices
  │     │     ├── get <doc-id>               [--tab]
  │     │     └── set <doc-id>               [--tab] [--data] — { rows, columns }
  │     ├── merges (alias: merge)                      Merged cells by anchor ref
  │     │     ├── get <doc-id>               [--tab]
  │     │     └── set <doc-id>               [--tab] [--data] — replaces the map
  │     ├── conditional-formats (alias: conditional-format)
  │     │     ├── get <doc-id>               [--tab]
  │     │     └── set <doc-id>               [--tab] [--data] — replaces the rules
  │     ├── data-validations (alias: data-validation)
  │     │     ├── get <doc-id>               [--tab]
  │     │     └── set <doc-id>               [--tab] [--data] — replaces the rules
  │     ├── charts (alias: chart)                      Charts anchored on the tab
  │     │     ├── get <doc-id>               [--tab]
  │     │     └── set <doc-id>               [--tab] [--data] — replaces the collection
  │     ├── filter                                     The tab's filter state
  │     │     ├── get <doc-id>               [--tab]
  │     │     └── set <doc-id>               [--tab] [--data] — `null` clears
  │     └── pivot                                      The tab's pivot table
  │           ├── get <doc-id>               [--tab]
  │           └── set <doc-id>               [--tab] [--data] — `null` clears
  │
  ├── slides (aliases: slide, deck)
  │     ├── list                             List slide decks (type: slides)
  │     ├── create <title>                   Create a new deck
  │     ├── get <doc-id>                      Show deck metadata
  │     ├── rename <doc-id> <title>          Rename a deck
  │     ├── delete <doc-id>                   Delete a deck
  │     ├── content <doc-id>
  │     │     [--format json|md|text]        (default: json)
  │     │     [--notes]                       (include speaker notes; md/text)
  │     │     [--out <file>|-]                (default: stdout)
  │     │     [--force]
  │     ├── export <doc-id> <file>
  │     │     [--format pptx]                (default: from extension)
  │     │     [--force]                       (overwrite existing file)
  │     ├── import <file>
  │     │     [--title <title>]               (default: file basename)
  │     │     [--replace <doc-id> --yes]      (destructive; required together)
  │     └── set-content <doc-id>             [--data <json>] (replaces the whole deck)
  │
  ├── notes (alias: note)
  │     ├── list                             List notes (type: note)
  │     ├── create <title>                   Create a new note
  │     ├── get <doc-id>                      Show note metadata
  │     ├── rename <doc-id> <title>          Rename a note
  │     ├── delete <doc-id>                   Delete a note
  │     ├── content <doc-id>
  │     │     [--format json|md|text]        (default: json)
  │     │     [--out <file>|-]                (default: stdout)
  │     │     [--force]
  │     ├── export <doc-id> <file>|-         (- writes Markdown to stdout)
  │     │     [--format md]                  (default: from extension; - ⇒ md)
  │     │     [--force]                       (overwrite existing file)
  │     ├── import <file>
  │     │     [--title <title>]               (default: file basename)
  │     │     [--replace <doc-id> --yes]      (destructive; required together)
  │     └── set-content <doc-id>             [--data <json>] (replaces the whole note)
  │
  ├── files (alias: file)
  │     ├── upload <file>                    Upload any file as a document
  │     │     [--title <title>]               (default: filename, with ext)
  │     │     [--folder <id>]                 (default: workspace root)
  │     ├── download <doc-id> [out]          (out: path, - for stdout;
  │     │     [--force]                       default: the document filename)
  │     ├── list                             List blob docs (file/pdf/image)
  │     │     [--type file|pdf|image]
  │     ├── get <doc-id>                      Show file document metadata
  │     ├── rename <doc-id> <title>          Rename a file document
  │     └── delete <doc-id>                   Delete it and its stored bytes
  │
  └── images (alias: image)                  The workspace image bucket
        ├── upload <file>                    png|jpeg|gif|webp, 10 MB cap
        ├── get <image-id> [out]             (out: path, - for stdout;
        │     [--force]                       default: the image id)
        └── delete <image-id>                 Delete the stored image
```

The Slides `content` command is text-only for `md`/`text`: it walks each
slide's elements (text boxes, shape labels, table cells, flattened
groups) and serializes the `TextBody` blocks via the same
`@wafflebase/docs` serializers used by `docs content`. Shapes, images,
connectors, positioning, and theming are dropped in those forms; `json`
returns the full `SlidesDocument` losslessly. Slides have no page
concept, so there is no `--pages` flag. PPTX export now ships
(`slides export <doc-id> <file.pptx>`) — it is the inverse of the
importer and achieves a full round-trip via the same OOXML writer, with
three documented v1 limitations: inline href links on text runs,
connector attached-endpoints are not yet wired in the exporter, and
group-targeted animation coupling is a documented v1 gap. PDF
export remains deferred (requires Canvas rasterization).

The Notes commands are the thinnest of the three document namespaces: a
note's entire content *is* a single markdown string held in one Yorkie
`Text` CRDT at `root.content` (byte-compatible with CodePair), so there is
no lossy serialization. `notes content` returns `{ "content": "…" }` for
`--format json` and the raw markdown for `md`/`text`; `notes export`
writes markdown only (a note is already markdown — PDF/HTML export is
deferred). `notes import` reads a `.md` file (or stdin) straight into the
content string. The backend content endpoint dispatches on the persisted
type (`doc` → docs tree, `slides` → slides tree, `note` → `Text`); the
CLI-side `getNoteContent`/`putNoteContent` reuse the same
`GET`/`PUT /documents/:id/content` route.

The Files commands are the only namespace with no content model at all: a
`file`/`pdf`/`image` document *is* its stored bytes
([generic-file-upload.md](generic-file-upload.md)), so there is no `content`
command and nothing is ever parsed. Three rules define the namespace:

- **`upload` never parses.** `wafflebase files upload budget.xlsx` stores the
  workbook as bytes; it does not become a spreadsheet. The parseable
  extensions (`.xlsx`, `.docx`, `.pptx`, `.csv`, `.md`) earn a one-line stderr
  hint naming the namespace that *would* parse them, and upload anyway — a CLI
  should do what the command says.
- **…but it does pick the viewer.** The server derives the document type from
  the stored blob id: `.pdf` → `pdf`, `png|jpg|jpeg|gif|webp` → `image`,
  everything else → `file`. Choosing a viewer is not parsing, and a PDF pushed
  from a terminal should open in the PDF viewer exactly like one dropped on the
  documents list. Deriving it from the *stored* id (whose extension has been
  through `safeExtension`) rather than the client's filename means the type can
  never contradict `assertFileIdAllowed`.
- **No stdin.** Every other `import` accepts `-`; `files upload` does not.
  Both the document type and the download extension come from the filename, and
  stdin has none — accepting it would silently produce an untyped, extension-less
  blob.

Upload is a single request (`POST /api/v1/workspaces/:wid/files`, multipart):
the backend stores the blob and creates the document together, deleting the
blob if the document row fails. The browser's queue splits these two steps
because it must survive a reload and resume without orphaning a second blob; a
CLI invocation has no resumable state, so the one-call form is both simpler and
safer. Size caps are checked client-side before the bytes go over the wire
(50 MB, or 25 MB for image extensions), mirroring `packages/backend/src/file/file.constants.ts`.

`files download` writes to the filename the server advertises in
`Content-Disposition` unless a path (or `-`) is given. That header comes from
the derived-not-echoed rule in `packages/backend/src/document/file-response.util.ts`, which the v1 route
reuses, so a `file` document always arrives as an opaque attachment; the CLI
reduces the advertised name to a bare filename before it can reach the
filesystem.

Everything under `sheets` below `export` is **worksheet state that is not a
cell**: formatting layers, sizing, view state, rules, charts and the
analysis objects. Each is a `get` / `set` pair over one
`GET` + `PUT /documents/:id/tabs/:tab/<resource>` endpoint, so the whole
group is one shape to learn — `--tab` (default `tab-1`), and on the write
side a JSON body from `--data` or stdin, exactly like `sheets cells batch`.
Two rules distinguish them, and both are in the safety table below:

- **Replace vs merge.** `styles`, `merges`, `conditional-formats`,
  `data-validations` and `charts` are whole-collection PUTs — anything
  omitted from the payload is deleted, which is why they are `destructive`.
  `sheet-style`, `column-styles`, `row-styles`, `column-widths` and
  `row-heights` merge per key, so they are `write` with a `destructive`
  variant for the `null` value that clears one entry.
- **The payload is the bare value, not the envelope.** `--data` takes the
  array / map / object itself; the client adds the `{ rangeStyles: … }`
  wrapper the endpoint wants. Each `set` also accepts the envelope its own
  `get` prints, so `sheets styles get D | sheets styles set D` round-trips.
  `--dry-run` prints the enveloped body byte-for-byte as it would be sent.

`clear`, `insert`, `delete` and `move` sit directly on `sheets`
because they are verbs, not state. They are the CLI face of the row/column
endpoints in [rest-api.md](rest-api.md) §5.4, so formulas, merges, styles,
validations and comment anchors follow the edit. `delete` removes
**rows or columns**; the verb that empties a cell range while keeping the
grid is `clear`.
The CLI validates only its own contract (a JSON object, `axis` of
`row`/`column`, positive integer indices); the grid bounds and the
`MaxAxisEntries` cap depend on the axis's current length, which only the
backend can see inside its own `doc.update`, so those arrive as its `400`.

`set-content` is the write half of `content` on `docs` / `slides` /
`notes`: one `PUT /documents/:id/content` with the body verbatim. The
backend picks the writer from the document's *persisted* type, not from
the namespace you typed, and answers `400` when the body shape disagrees
(or `409 TYPE_MISMATCH` for a spreadsheet) — so the CLI validates nothing
beyond "is it JSON", rather than keeping a second copy of that contract
that could drift from it.

The `images` namespace is the workspace image bucket the slides / board /
docs renderers fetch embedded images from. It is workspace-scoped, not
document-scoped: an image blob has no link back to the document that
embeds it (that reference lives in the CRDT), so there is no doc id and no
`--tab`. Upload is multipart and takes a path, never stdin, for the reason
`files upload` does — the content type comes from the filename. The
allow-list (`png`/`jpeg`/`gif`/`webp`) and the 10 MB cap mirror
`images.controller.ts` and are checked before the bytes go over the wire.
`images get` is a binary download in the `files download` shape, except
that the read route sends no `Content-Disposition`, so the default output
name is the image id.

**Global flags**: `--server`, `--api-key`, `--workspace`, `--profile`,
`--format json|table|csv|yaml` (default: json), `--quiet`, `--verbose`,
`--dry-run`. The `--format` flag also doubles as the per-content shape
on `docs content` (`json|md|text`) and `docs export` (`pdf|docx`);
commander funnels duplicate flag names to the global option, so the
action layer reads `opts.format` and validates against the per-command
vocabulary.

**Page-range syntax**: `1-3`, `2`, `1,3,5`, or `1-3,5,7-9`. Out-of-range
values clamp with a stderr warning; malformed input exits with code
`1`.

**Breaking changes from v0.3.6 → v0.3.7** (no deprecation period; the
old top-level Sheets commands were removed when the symmetric namespace
restructure landed):

| Old                                | New                                       |
| ---------------------------------- | ----------------------------------------- |
| `wafflebase doc …`                 | `wafflebase docs …` (alias `doc`)         |
| `wafflebase tab list …`            | `wafflebase sheets tabs list …`           |
| `wafflebase cell get/set/…`        | `wafflebase sheets cells get/set/…`       |
| `wafflebase import <id> <file>`    | `wafflebase sheets import <id> <file>`    |
| `wafflebase export <id> <file>`    | `wafflebase sheets export <id> <file>`    |
| `wafflebase api-key …`             | `wafflebase api-keys …` (alias `api-key`) |

`docs content` on a sheet document, and `sheets cells …` on a doc-typed
document, both return a type-mismatch error with a pointer to the
correct namespace.

### 5. Usage Examples

```bash
# Login
wafflebase login

# List documents (JSON by default)
wafflebase docs list
wafflebase docs list --type doc           # only word-processor docs
wafflebase docs list --format table       # human-readable table

# Read cells
wafflebase sheets cells get abc-123                 # all cells, JSON
wafflebase sheets cells get abc-123 A1:C10          # range
wafflebase sheets cells get abc-123 --tab tab-2     # specific tab

# Write cells
wafflebase sheets cells set abc-123 A1 "Hello World"
wafflebase sheets cells set abc-123 B2 "=SUM(A1:A10)" --formula

# Batch update (JSON from stdin)
echo '{"A1":"Name","B1":"Score","A2":"Alice","B2":"95"}' \
  | wafflebase sheets cells batch abc-123

# Dry-run: show the request without executing
wafflebase sheets cells set abc-123 A1 "Hello" --dry-run

# Import/Export (sheets — CSV/JSON)
wafflebase sheets import abc-123 data.csv
wafflebase sheets export abc-123 output.json --range A1:D100

# Pipe-friendly (reads from stdin, writes to stdout)
cat data.csv | wafflebase sheets import abc-123 -
wafflebase sheets export abc-123 - --file-format csv | head -20

# Word-processor docs
wafflebase docs content abc-123 --format md            # render as Markdown
wafflebase docs content abc-123 --format text --pages 1-3
wafflebase docs export abc-123 out.pdf                 # export to PDF
wafflebase docs export abc-123 out.pdf --pages 1-3     # exact page subset
wafflebase docs export abc-123 out.docx                # export to DOCX
wafflebase docs import draft.docx                      # new doc from .docx
wafflebase docs import revision.docx --replace abc-123 --yes

# Worksheet state beyond the cells
wafflebase sheets styles get abc-123 --tab tab-1
echo '{"1":180,"2":90}' | wafflebase sheets column-widths set abc-123
echo '{"rows":1,"cols":0}' | wafflebase sheets freeze set abc-123
wafflebase sheets charts get abc-123 | wafflebase sheets charts set abc-123
echo 'null' | wafflebase sheets filter set abc-123          # clear the filter

# Rows and columns
echo '{"range":"A2:C99"}' | wafflebase sheets clear abc-123
echo '{"axis":"row","index":2,"count":3}' | wafflebase sheets insert abc-123
echo '{"axis":"row","srcIndex":5,"count":1,"dstIndex":2}' | wafflebase sheets move abc-123

# Whole-content writes (destructive; the read half is `content`)
wafflebase docs content abc-123 > doc.json
wafflebase docs set-content abc-123 --data "$(cat doc.json)"

# Workspace images
wafflebase images upload logo.png
wafflebase images get img-42 logo.png --force
wafflebase images delete img-42

# Files (any file, stored as bytes)
wafflebase files upload archive.zip                    # → a `file` document
wafflebase files upload diagram.png --title "Arch v2"  # → an `image` document
wafflebase files upload report.pdf                     # → a `pdf` document
wafflebase files list --type file
wafflebase files download abc-123                      # → ./archive.zip
wafflebase files download abc-123 out/archive.zip --force
wafflebase files download abc-123 - | shasum           # bytes to stdout

# Storing a parseable file as bytes is allowed, and says so:
wafflebase files upload budget.xlsx
# Note: uploading as raw bytes. Use `wafflebase sheets import` to import it
# as an editable document instead.

# Schema introspection (canonical plural names — singular aliases also resolve)
wafflebase schema sheets.cells.get         # show parameters and response shape
wafflebase schema docs.content
wafflebase schema cell.get                 # alias → resolves to sheets.cells.get

# Auth state (JSON by default; agents branch on `loggedIn`)
wafflebase status
wafflebase status --format table            # human-readable key/value

# Context switching
wafflebase ctx list                        # [{ id, name, active }]
wafflebase ctx list --format table         # human-readable table
wafflebase ctx switch "Team Workspace"

# API key management
wafflebase api-keys create "CI Pipeline"
wafflebase api-keys list
wafflebase api-keys revoke key-uuid
```

### 6. Docs Pipeline Internals

The CLI runs serialization, pagination, and DOCX/PDF rendering locally
by importing `@wafflebase/docs`. The backend exposes only raw
`Document` JSON (see [rest-api.md](rest-api.md) §5.4). Pagination is
backend-agnostic via a `TextMeasurer` interface; the CLI ships a
`fontkit`-backed measurer that reuses the fonts already bundled for
PDF export.

#### 6.1 `TextMeasurer` Abstraction in `@wafflebase/docs`

`computeLayout` historically called `ctx.measureText` on a 2D Canvas. To
allow the CLI (Node) to lay out text without a native canvas binding, it
takes an injectable measurer:

```ts
// packages/docs/src/view/measurer.ts
export interface ResolvedFont {
  family: string;
  size: number;        // px
  weight: 'normal' | 'bold';
  style: 'normal' | 'italic';
}

export interface TextMeasurer {
  measureWidth(text: string, font: ResolvedFont): number;
  // additional methods factored out of the original Canvas surface
}

// packages/docs/src/view/canvas-measurer.ts (browser default)
export class CanvasTextMeasurer implements TextMeasurer { /* … */ }
```

`computeLayout(blocks, measurer, contentWidth, …)` accepts the measurer
as a parameter; `paginateLayout(layout, pageSetup)` then splits the
already-computed layout into pages and needs no measurer. All existing
call sites (renderer, editor, PDF exporter, frontend integration, test
fixtures) pass a `CanvasTextMeasurer`. Tests that previously relied on
Canvas mocks use a deterministic stub measurer.

#### 6.2 `FontkitMeasurer` in the CLI

`packages/cli/src/docs/fontkit-measurer.ts` implements `TextMeasurer` by
loading fonts through `fontkit` directly (`fontkit.create()`), keeping
its own `register()` method and private `fonts` Map rather than reusing
the PDF exporter's font loader. Width is computed as `advanceWidth ÷
unitsPerEm × size`. The in-memory font cache is keyed by a lowercased
`${family}|${weight}|${style}` variant. NotoKR loaders stay lazy so they
only run when a command actually paginates.

#### 6.3 DOCX Import via Backend Endpoints

The CLI does not depend on the Yorkie SDK. The DOCX import flow is:

```text
default (new document):
  POST /api/v1/.../documents       { title, type: 'doc' }   → returns id
  PUT  /api/v1/.../documents/:id/content  Document JSON

with --replace <doc-id> --yes:
  PUT  /api/v1/.../documents/:doc-id/content  Document JSON
```

`PUT` returns the new `Document` (echo) so the CLI can emit a
confirmation payload in JSON.

#### 6.4 Reference flow

`wafflebase docs content abc-123 --format md --pages 1-3`:

```text
1. CLI: HttpClient.getDocContent("abc-123")
2. Backend: Yorkie attach "doc-abc-123" → return Document JSON
3. CLI: computeLayout(blocks, FontkitMeasurer) → paginateLayout(layout, pageSetup)
4. CLI: select blocks intersecting pages 1-3 (rule from § 6.6)
5. CLI: blocksToMarkdown(...)
6. CLI: write to stdout (or --out)
```

#### 6.5 Markdown Mapping

| Element                                    | Mapping                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| title                                      | `#`                                                                      |
| subtitle                                   | `*…*` italic paragraph                                                   |
| heading h1–h6                              | `#` … `######`                                                           |
| paragraph                                  | regular paragraph                                                        |
| list-item ordered                          | `1.` (renderer renumbers)                                                |
| list-item unordered                        | `-`                                                                      |
| nested list                                | 2 spaces of indent per `listLevel`                                       |
| horizontal-rule                            | `---`                                                                    |
| page-break                                 | `<!-- pagebreak -->`                                                     |
| table                                      | GFM table; merges, styles, and nested tables are dropped; first row used as header |
| alignment / indent / line-height           | dropped                                                                  |
| bold                                       | `**text**`                                                               |
| italic                                     | `*text*`                                                                 |
| underline                                  | dropped (no standard Markdown)                                           |
| strikethrough                              | `~~text~~`                                                               |
| color / background / font / size           | dropped                                                                  |
| superscript / subscript                    | dropped                                                                  |
| link                                       | `[text](href)`; the destination must be a *literal* one — only RFC 3986 URI characters (so no `<`, `>` or `\`, the three a CommonMark renderer rewrites), no whitespace or control characters, and no `&…;` entity reference — and must then either carry a safe scheme or be relative. An unsafe scheme (`javascript:`, `data:text/html`, …), a scheme-relative `//host/x`, or a first path segment containing a colon (`foo:bar/x`, which RFC 3986 §4.2 says every parser reads as a scheme — spell it `./foo:bar/x`) drop the link and keep the text. Relative targets (`/uploads/x`, `./x`, `#anchor`) are kept; parentheses are backslash-escaped |
| image                                      | `![alt](src)`; if `--inline-images=false` (default), `data:` URLs become `[image]`, as does any source the link rule above would reject — except `data:image/…`, which `--inline-images` exists to carry |
| page-number marker                         | literal `#` at its location                                              |
| header / footer                            | included only when `--include-header-footer=true`                        |

The Markdown path emits a one-line stderr notice on first use per
command invocation: "Lossy conversion: see cli.md design for the exact
mapping". Suppressed by `--quiet`.

#### 6.6 Page Slicing Semantics

`--pages 1-3,5` triggers pagination via `computeLayout(blocks,
FontkitMeasurer)` followed by `paginateLayout(layout, pageSetup)` so the
CLI knows each block's `lines[].pageIndex`.
Slicing behavior is format-aware:

| Format  | Slicing rule                                                                                          |
| ------- | ----------------------------------------------------------------------------------------------------- |
| `json`  | Include any block whose lines intersect the requested pages. Each block keeps its full `lines[]` metadata so the consumer can re-derive page boundaries. |
| `md`    | Include any block whose lines intersect the requested pages; emit the block whole (no mid-block cut). A block that spans two requested pages appears once. |
| `text`  | Same selection rule as `md`; output is plain text only.                                               |
| `pdf`   | Exact page subset. Implemented by passing the page index list into `PdfExporter`; if that path is not yet supported, fall back to rendering the full PDF and using `pdf-lib` to extract the requested pages. |
| `docx`  | `--pages` triggers a stderr warning ("DOCX has no page concept — exporting full document") and the full document is exported. Exit code 0. |

`--include-header-footer` only affects `md`/`text`; `pdf`/`docx` always
respect their native header/footer regions, and the `json` form always
includes `document.header`/`document.footer` verbatim.

### 7. Project Structure

```text
packages/cli/
  package.json           @wafflebase/cli, bin: { "wafflebase": "./dist/bin.js" }
  tsconfig.json
  vitest.config.ts
  src/
    bin.ts               Entry point (#!/usr/bin/env node); delegates to cli.ts
    cli.ts               buildProgram() + runCli() (parseAsync + error envelope)
    errors.ts            Failure classification: SystemError, httpError,
                         fetchOrThrow, exitCodeFor(Status), redactUrl
    commands/
      root.ts            Root program, global flags, config loading
      login.ts           login (browser OAuth)
      logout.ts          logout
      status.ts          status
      ctx.ts             ctx list/switch
      docs.ts            docs list/create/get/rename/delete + content/export/import
      slides.ts          slides list/create/get/rename/delete + content/export/import
      notes.ts           notes list/create/get/rename/delete + content/export/import
      files.ts           files upload/download/list/get/rename/delete
      sheets.ts          Dispatcher: sheets {tabs,cells,import,export}
      tabs.ts            sheets tabs list / create / rename
      cells.ts           sheets cells get/set/batch/delete
      sheets-import.ts   sheets import CSV/JSON
      sheets-export.ts   sheets export CSV/JSON
      schema.ts          schema introspection
      api-keys.ts        api-keys create/list/revoke
    docs/                Word-processor pipeline
      content.ts         runDocsContent orchestrator (json/md/text + --pages)
      pdf-export.ts      exportPdf via PdfExporter + FontkitMeasurer + pdf-lib slicing
      docx-export.ts     exportDocx wrapper around DocxExporter
      docx-import.ts     importDocx + base64 ImageUploader + InvalidDocxError
      import.ts          runDocsImport orchestrator (POST + PUT, --replace flow)
      paginate.ts        paginateForCli helper (computeLayout + paginateLayout)
      page-range.ts      parsePageRange (1-3,5,7-9 + clamp warnings)
      page-slice.ts      sliceBlocksByPages
      fontkit-measurer.ts FontkitMeasurer (TextMeasurer for Node)
      image-fetcher.ts   Fetch remote/data image bytes for inline embedding
      dom-polyfill.ts    @xmldom/xmldom shim for DocxImporter's DOMParser usage
    slides/              Presentation pipeline
      content.ts         runSlidesContent orchestrator (json + per-slide md/text)
      import.ts          runSlidesImport orchestrator (POST + PUT, --replace flow)
      pptx-export.ts     exportPptx wrapper (inverse of the PPTX importer)
      pptx-import.ts     importPptx wrapper + base64 image uploader
    notes/               Markdown-note pipeline
      content.ts         runNotesContent orchestrator (json {content} + raw md/text)
      import.ts          runNotesImport orchestrator (POST + PUT, --replace flow)
    files/               Blob-document pipeline (no content model)
      upload.ts          runFilesUpload orchestrator (size caps, MIME, parse hint)
      download.ts        runFilesDownload orchestrator + download-target resolution
    client/
      http-client.ts     REST API v1 wrapper (undici fetch via fetchOrThrow)
      content-disposition.ts  Filename parser for binary responses
      dry-run.ts         Dry-run request printer
      url.ts             seg() — one-segment id encoding — plus the URL
                         builders, shared by the client and the dry-run printer
    config/
      config.ts          Config file + env + flag resolution
      session.ts         Session file read/write + token refresh
    util/
      csv-parse.ts       CSV parsing helper for sheets import
    output/
      formatter.ts       Format dispatcher (json | table | csv | yaml)
      binary.ts          writeBinary helper for PDF/DOCX exports
      table.ts           Table formatter
      json.ts            JSON formatter
      csv.ts             CSV formatter
    schema/
      registry.ts        Command metadata registry (plural canonical + alias map)
  skills/                Agent skill definitions (Markdown, namespace-prefixed)
    SKILL.md             Skill index and conventions
    sheets-read-cells.md / sheets-write-cells.md / sheets-import-export.md
    docs-manage.md / docs-read-content.md / docs-export-pdf.md
    docs-export-docx.md / docs-import-docx.md
    slides-manage.md / slides-read-content.md / slides-export-pptx.md / slides-import-pptx.md
    files-upload-download.md
    recipe-csv-pipeline.md / recipe-data-collect.md
    recipe-docx-to-pdf.md / recipe-doc-to-markdown.md
  scripts/
    gen-sample-docx.mjs  One-shot generator for the integration .docx fixture
    gen-sample-pptx.mjs  One-shot generator for the integration .pptx fixture
    debug-cmd.mjs        Local command-runner helper for manual CLI debugging
```

**Root pnpm scripts**:

```json
{
  "cli": "pnpm --filter @wafflebase/cli",
  "cli:dev": "pnpm --filter @wafflebase/cli dev"
}
```

**Development usage**:

```bash
pnpm cli dev -- docs list                # monorepo
npx @wafflebase/cli docs list            # after publish
npm install -g @wafflebase/cli           # global install
```

### 8. Agent Integration

The CLI is designed as a first-class tool for AI agents (Claude Code,
Gemini CLI, Cursor), inspired by the
[Google Workspace CLI](https://github.com/googleworkspace/cli).

#### 8.1 Structured Output

All output is JSON by default. Errors are also JSON so agents can parse
success and failure uniformly:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Document abc-123 not found",
    "command": "docs.content"
  }
}
```

Argument-parsing failures are part of that contract, not an exception to
it. Commander exits *during parsing*, before any action handler runs, so
its own errors would otherwise print bare prose and skip the envelope —
the one failure an agent driver is most likely to hit. `createProgram()`
sets `exitOverride()` plus a no-op `outputError` output hook so the parse
error reaches `runCli`'s catch as a `CommanderError`, which envelopes it
under the stable code `USAGE`:

```console
$ wafflebase docs content
{"error":{"code":"USAGE","message":"missing required argument 'doc-id'"}}
```

It carries no `command`: commander throws before any action handler runs,
so there is no acting command to attribute it to (§9).

`--help`, `--version`, and bare `wafflebase` travel the same throw path
(`commander.helpDisplayed` / `commander.version` / `commander.help`) but
have already written their body, so they pass through with their exit code
and no envelope.

Exit codes: `0` success, `1` user error (bad input, not found),
`2` system error (network, auth, server fault). Agents can branch on the
exit code without parsing the error body. A missing *local* session is
the caller's to fix rather than the environment's, so `NOT_LOGGED_IN`
exits `1`.

The class is decided where the failure is raised, not sniffed out of the
message text at the output site — `packages/cli/src/errors.ts` holds the
whole contract:

| Failure | `error.code` | Exit |
| --- | --- | --- |
| `fetch` never reached an HTTP server (DNS, refused, TLS) | `NETWORK_ERROR` | `2` |
| HTTP 401 / 403 | `AUTH_ERROR` | `2` |
| HTTP 5xx | `SERVER_ERROR` | `2` |
| A 2xx the CLI cannot use (no `id` on create, a bodyless download) | `INVALID_RESPONSE` / `HTTP_ERROR` | `2` |
| HTTP 400 / 404 / 409, bad flags, type mismatch | command-specific or `ERROR` | `1` |

`SystemError` carries both the `code` that lands in the JSON body and the
`exitCode` that `outputError` applies, so the two can never drift. Every
`fetch` in the CLI goes through `fetchOrThrow` — the one exception is the
image fetcher's `rawRequest`, which drops to undici's low-level `request`
to read a hop the fetch layer opaque-filtered and raises the same
`SystemError('NETWORK_ERROR')` by hand — and the status decides the
class at every non-OK response: `throw httpError(status)` where the CLI
writes the message, and `process.exitCode = exitCodeForStatus(status)` on
the `content`/`export` paths that instead print the backend's own error
envelope verbatim. That second path matters because a `401`
`SESSION_EXPIRED` body is JSON — printing it must not make an expired
session look like bad user input.

`login` prints prose instead of the JSON envelope but reads the same
table: `fetchLoginSession` classifies the exchange / `me` / `workspaces`
responses through `exitCodeForStatus`, so a stale callback code (`400`)
exits `1` while a rejected token or a broken server exits `2`. Anything
not in the contract keeps its stack trace rather than being flattened to
one line.

Error messages carry a redacted URL (`redactUrl`): userinfo from
`--server`/`WAFFLEBASE_SERVER` and presigned query strings from image
URLs never reach stderr or CI logs; scheme, host and path do. The
underlying transport error is scrubbed the same way before it is quoted
— undici echoes the request URL verbatim for some failures, which would
otherwise put back exactly what was just removed. Userinfo is stripped
textually rather than through the URL parser's `username` setter, which
is a no-op for the opaque-path form a scheme-less `--server` produces.

An unparseable URL is the one `fetch` rejection that is *not* a system
error: nothing was ever unreachable, the caller's `--server` was wrong.
It is separated out before the request and exits `1` (`INVALID_URL`).

`--quiet` gates progress notices only. Neither the result body nor the
error envelope is suppressed by it — a non-zero exit with no bytes on
either stream tells the caller nothing — and neither is the exit code,
which is what scripts branching on `$?` actually read.

Every command that renders a *structured result* routes it through
`output()`, including the session commands `status` and `ctx list`,
which used to print English sentences and ignore `--format`. (Commands
that only acknowledge an action — `login`, `logout`, `ctx switch` —
still print a prose line, and the file writers — `sheets export`,
`docs`/`slides`/`notes` `export` — write their body straight to the
file or stdout, since it is a document, not a command result.)

Four commands are still gaps rather than exceptions:
`docs`/`slides`/`notes` `import` and `files upload` emit a real command
result (`{ id, replaced }`, `{ id, title }`, or the uploaded document)
but serialize it with a bare `JSON.stringify` and never read `--format`,
so `docs import --format table` still prints JSON. All four render
through their own injected IO seam — `ImportIO`, and `upload.ts`'s
`io.stdout`, the seams that make the stdin/TTY/confirm branches
testable — rather than through the global formatter, so routing them is
a change to that seam, not a call-site swap, and is left to its own
change. Until then the sentence above holds for every command *except*
those four.

`status` reports the answer to "am I logged in?" as data
and still exits `0` when there is no session:

```json
{ "loggedIn": false, "message": "Not logged in. Run `wafflebase login`." }
```

`ctx list` cannot answer without a session, so it emits the standard
error body with `"code": "NOT_LOGGED_IN"` and exits `1`.

An unsupported `--format` value is rejected with
`"code": "INVALID_FORMAT"` rather than ignored. Validation is
per-command because `docs`/`slides`/`notes` `content` and `export`
deliberately reuse the same global `--format` flag for their own
vocabularies (`md`, `text`, `pdf`, `docx`, `pptx`) — those commands
check against their own list but raise the same `InvalidFormatError`, so
`INVALID_FORMAT` means "bad `--format`" everywhere and the message names
the values that command accepts. A format that cannot be *inferred*
(`docs export out.txt` with no `--format`) is a different failure and
stays a plain `ERROR`.

Every CSV the CLI writes neutralizes spreadsheet formula prefixes: a
value starting with `=`, `+`, `-`, or `@` is emitted with a leading `'`
so it lands as text, since every value in the output is server-supplied
and another workspace member can set it. The decision is made on the
value an importer will *see*, not on the raw bytes — leading whitespace
(space, tab, CR, U+00A0, BOM) is skipped before the test, because
importers that trim on the way in (LibreOffice's "Trim spaces", and
several CSV-to-sheet tools) would otherwise evaluate ` =HYPERLINK(…)`
as a formula the neutralizer had waved through. Plain signed numbers
(`-3`, `+1.5e6`), padding and all, are left alone. Any value carrying a
comma, quote, or control character is quoted — `\r` included, or a bare
CR would end the record early in importers that honour it and start the
next one with a formula the neutralizer never inspected.

`sheets export <doc> out.csv` is the CSV most likely to be *opened* in a
spreadsheet app, so it neutralizes too. Its one caller that must not is
the round-trip pipeline (`packages/cli/skills/recipe-csv-pipeline.md`),
where an exported `=SUM(B2:B100)` has to re-import as that formula and
not as the text `'=SUM(B2:B100)` — that asks for `--raw` explicitly.
The other half of that round trip lives in `sheets import`: it detects
the `ref,value,formula[,style]` header this export writes and imports
**by reference** (not as a positional grid, which would land the word
`ref` in A1), sending a cell's `formula` as `formula` and any other
`=`-leading text likewise — the batch API stores `f` and `v` in
different fields, so a formula sent as a value is never evaluated.
Opting out is the caller saying they trust the sheet, which is not a
thing the default may assume. `formatCsv` still takes an explicit
`neutralizeFormulas` flag rather than defaulting, so the answer stays a
per-call decision instead of one silently inherited by the next caller
added. Quoting is shared: it is CSV correctness, and a parser unquotes
it on the way back in.

##### Export image fetching

Exports (`docs export`, `slides export`) dereference the image `src`
values found in the document, which are attacker-influenced — anyone who
can edit or share a document picks them. `assertFetchableImageUrl` gates
every one before it is requested, and again on every redirect hop
(redirects are followed by hand, `redirect: 'manual'`, so an allowed host
cannot bounce the CLI onto an internal one):

- only `http:`, `https:` and `data:` are dereferenced, so `file:` cannot
  read local files into the exported artifact;
- address *literals* are checked against loopback / RFC1918 / CGNAT /
  link-local / unique-local, in every spelling — `::ffff:127.0.0.1` and
  `::ffff:7f00:1` are expanded to the same eight words rather than
  matched as text;
- host *names* are only checked against `localhost`, `.localhost`,
  `.internal` and `.local` (a name is not an address: `fc2.com` is a
  public site, not `fc00::/7`), and are then resolved, so a record
  pointing at `169.254.169.254` is refused as well;
- the configured **server** is the one internal destination still
  allowed, because `--server http://localhost:3000` is the normal dev
  setup and self-hosted documents store absolute internal URLs. The
  frontend persists image `src` values absolute, so a dev document says
  `http://localhost:3000/...` while the CLI may be pointed at
  `--server http://127.0.0.1:3000`; comparing origin strings would
  refuse those documents' own images. Three ways to be the server, on
  the same port: the **same name**; **loopback under either spelling**
  (`localhost` / `127.0.0.1` / `::1` / `[::1]` name one listener, and
  the equivalence is between the *names*, so `localhost` answering only
  `::1` still admits the `127.0.0.1` spelling); or an **address
  literal** that is one of the server's resolved addresses.

  A name that is not the server's name is never the server, however it
  resolves. Matching purely on the resolved address — which this did at
  first — hands the document author a name of their own pointed at the
  API server's address on its port, and with it any path there under an
  attacker-chosen `Host`, including a co-located virtual host. An
  address literal keeps the resolved-identity comparison because a
  literal designates one machine and no resolver can steer it.

  Another port on the same host is not covered — the exemption is the
  API server, not the machine.

A blocked `src` fails the export with `IMAGE_URL_BLOCKED` (exit `1` — the
document is wrong, not the environment). A name that cannot be resolved
fails **closed**, as `NETWORK_ERROR` (exit `2`): the gate and the fetch
resolve independently, so allowing an unresolvable name would let a host
whose nameserver stalls the gate's lookup and answers the connect-time
one with `127.0.0.1` straight through.

The verdict is per **address**, not per URL: the configured server's own
addresses are exempt, every other address the host answers with is
judged on its merits, and the request is then **pinned** to the
addresses that passed. Pinning is what makes the gate hold across the
two independent lookups — the CLI depends on `undici` directly and hands
each request an `Agent` whose `connect.lookup` returns the approved
answers, so a rebinding nameserver that answers the gate publicly and
the connect with `169.254.169.254` never gets a connection. It is also
why an address the gate rejected can be dropped rather than failing the
whole URL: it is unreachable either way.

**Egress proxies.** A CLI has no API through which an operator can
install a dispatcher, so the conventional environment variables
(`http_proxy` / `https_proxy` / `all_proxy`, honoring `no_proxy`, either
letter case) *are* the proxy configuration surface. When one applies to
a hop, that hop is dispatched through a `ProxyAgent`. The gate itself is
unchanged — a `src` that resolves to an internal address is refused
before any request is made, proxied or not.

The `Agent`-level pin cannot be combined with a proxy: it works by
overriding the connector's resolver, and the only name a proxied
connector resolves is the proxy's own. Dropping it there would not be
free — the proxy would resolve the image host itself, and its answer is
not the one the gate approved, so a ~0s-TTL nameserver could answer the
gate publicly and the proxy privately and reach an address the gate
refused (the *proxy's* network rather than the CLI's).

So the pin travels with the request instead of being abandoned. The
hop's URL is rewritten to an address the gate approved and *that* is
what the proxy is asked for (`CONNECT 192.0.2.10:443`, or an
absolute-form `GET http://192.0.2.10/…`), while the identity of the
request stays the host the document named: `Host:` for the HTTP request,
and the TLS `servername` (`ProxyAgent`'s `requestTls`) for SNI and
certificate validation. The proxy resolves nothing, so it has no second,
divergent answer to act on. Two consequences: the hop goes out through
undici's low-level `request` rather than `fetch`, because WHATWG `fetch`
forbids setting `Host` and sending the address as the host name would
break every virtual-hosted CDN; and the rewrite applies only to a
name — a `src` that already names an address literal is passed through
unchanged, since it is already the approved address.

The one case where the pin cannot be carried is a proxy that
allow-lists names and refuses `CONNECT` to an address literal. That hop
retries by name, once, and the whole run stops trying the address form
(the proxy has answered that question). This is a property of the
environment rather than of the document, so it is not
attacker-triggerable, and the alternative — failing the export outright
on exactly the machines that can only egress through such a proxy — is
the worse trade. The residual risk after a fallback is the one described
above: the proxy resolves the name, and a rebinding nameserver could
hand it an address the gate refused.

A fallback is not silent. The first hop that gives the pin up writes one
line to stderr saying so and why, naming the hop that triggered it;
every later hop in the same export is silent, because a document with
fifty images states the fact once. A pinned proxied fetch says nothing,
because nothing was given up. The person who set `https_proxy` is the
only one who can judge whether that proxy's resolver is trustworthy, and
this is what puts the question in front of them.

##### Nonce-bound login callback

`wafflebase login` listens on `http://127.0.0.1:<port>/callback`, which
any local process — or any web page that guesses the port — can reach. So
the code alone does not complete a login: the CLI generates a nonce,
ships it as `?nonce=` on the `/auth/github` URL, the backend stores it in
the CLI state and echoes it back as `state` on the loopback redirect, and
the CLI accepts only a callback whose `state` matches (constant-time
compare). Mismatched requests get `403` and are ignored — they can
neither complete nor cancel the pending login, so a hostile page cannot
fix the CLI onto its own account. §3.1 describes the round trip and the
`--allow-unbound-callback` opt-out for a server that predates the echo.

The binding is enforced on the **CLI** side, which is where it works: a
callback that arrives without the expected `state` is refused, and the
login then times out — with the refusal's cause named, but never with
advice to turn the binding off (see below).

The **backend** halves of the same question — did this browser start
this login, and can this code be redeemed by anyone who merely saw it? —
are answered by `GitHubAuthGuard`, `CliLoginConfirmMiddleware` and the
PKCE pair:

- `/auth/github?mode=cli` refuses a request whose `Sec-Fetch-Site` says
  another site navigated the browser into it (`none` / `same-origin` /
  `same-site`, or a client that sends no such header, are served).
  Without that, a hostile page could start a `?mode=cli` round trip in
  the victim's browser with a loopback port of its choosing, and a code
  minted from the victim's GitHub session would be delivered there. The
  cookies cannot cover this case: the navigation that carries the attack
  is the same navigation that would set them. The check is scoped to the
  CLI branch — a browser login is legitimately cross-site whenever the
  frontend and `VITE_BACKEND_API_URL` do not share a site, and it has no
  loopback delivery to protect.
- A `?mode=cli` login is then gated on a click through
  `CliLoginConfirmMiddleware`'s confirmation page, whose Continue link
  carries a one-time secret that also went out as an httpOnly cookie.
- The `state` of both flows is bound to the browser that started the
  login. The web flow uses a double-submit pair: a random secret in the
  `__Host-wafflebase_oauth_state` cookie, its SHA-256 to GitHub as
  `web.<hash>` — no server-side map, so it survives restarts and works
  across replicas. The CLI flow keeps its server-side `CliAuthStore`
  entry (a cookie cannot deliver the port, nonce and challenge to a
  loopback listener) and pairs it with a secret in the
  `__Host-wafflebase_cli_state` cookie, of which only `sha256(secret)`
  is stored. Both are cleared on use and spent whatever the outcome, so
  a state token seen elsewhere — a shared terminal, a CI log — cannot be
  replayed into a victim's browser. The `__Host-` prefix is what stops a
  sibling subdomain from writing either cookie; outside production,
  where the browser will not honour it without `Secure`, the names are
  unprefixed.
- The code the CLI receives is a **proof-of-possession** credential, not
  a bearer one. `login` generates a PKCE verifier, sends only
  `sha256(verifier)` as `?challenge=`, and `POST /auth/cli/exchange`
  redeems the code with `{ code, verifier }`. The code travels over a
  plaintext loopback hop, so on its own it must not buy a session; the
  verifier never leaves the CLI process. A CLI that sends no challenge
  is refused with a message telling it to update, rather than handed a
  weaker credential.

**The OAuth URL is a credential while the login is pending**, which is
why it reaches neither argv nor a log — see "The authorization URL never
reaches argv or a log" above for the launch-token indirection and the
`0600` `login-url.txt` fallback. What it does *not* leak, even when it is
read, is remote access: the callback is `127.0.0.1`, so completing the
fixation also requires reaching the victim machine's loopback within the
listener's lifetime, i.e. already running code there.

The timeout message names the last refusal but never prescribes the
downgrade. An earlier version pointed at `--allow-unbound-callback`
whenever a `state`-less callback had arrived — but that listener is
reachable by exactly the adversary the nonce exists to stop, so the
diagnostic was attacker-settable. A hostile page could send one
`state`-less `/callback?code=<its own code>`, and the CLI would then
prescribe the one flag that turns the binding off; taking that advice
completes a login fixation, since the replayed callback carries the
attacker's code and the victim ends up holding a session for the
attacker's account. So the refusal reports *what happened* — no `state`,
a `state` that does not match, a non-GET request — and, for the
`state`-less case, that the server is likely older than the CLI and
should be updated. The flag itself is discoverable only through
`wafflebase login --help` and the CLI README, places an attacker has no
say over.

`GitHubAuthGuard` validates both CLI parameters as closed vocabularies
before they are stored: a nonce must be `[0-9a-f]{32,128}` and a
challenge exactly 43 base64url characters (the length of a SHA-256
digest). Anything else — including a repeated query parameter, which
arrives as an array — is dropped rather than stored, because both values
are interpolated into a redirect or into the confirmation page's link
and must have no room to smuggle a query parameter. A dropped nonce is
served anyway (the redirect then simply carries no `state`, and an older
CLI never asked for one), but a dropped *challenge* is refused at the
callback: minting a code with no challenge would hand back a bearer
credential, which is the thing the challenge exists to prevent.

#### 8.2 Dry-Run

`--dry-run` validates inputs, resolves the target API endpoint, and
prints the request that would be sent — without executing it.

```bash
$ wafflebase sheets cells set abc-123 A1 "Revenue" --dry-run
{
  "dry_run": true,
  "method": "PUT",
  "url": "https://api.wafflebase.io/api/v1/workspaces/ws-1/documents/abc-123/tabs/tab-1/cells/A1",
  "body": { "value": "Revenue" }
}
```

Per-command dry-run notes:

- Reads honour the flag too, in every namespace: `docs list` / `get` /
  `content` / `export`, `notes list` / `get` / `content` / `export`,
  `slides list` / `get` / `content` / `export`, `files list` / `get` /
  `download`, `sheets tabs list`, `sheets cells get`, `sheets export`, and
  `api-keys list` print their GET without fetching, so a preview burns no
  rate limit and emits no access log even when the command is harmless. The
  one command the flag does not hold back is `login`: it still completes the
  OAuth exchange and writes the session, because there is no useful preview
  of an interactive browser handshake.
- Credential management is no exception: `api-keys create` and
  `api-keys revoke` preview the POST / DELETE rather than minting a live
  key (whose secret is printed once) or irreversibly revoking one. Their
  endpoints sit at `/workspaces/:id/api-keys`, outside the v1 API base, so
  the preview prints that URL rather than a `/api/v1/...` one. Both the
  preview and the live request build that URL with the same `apiKeysUrl()`
  helper in `client/url.ts`, so a route change cannot leave the preview
  describing a request nobody sends.
- Identifiers are URL-encoded into the previewed path exactly as the client
  encodes them into the real request — one `seg()` in `client/url.ts`, used
  by both — so the printed path is the path that would be fetched. Every
  interpolated identifier goes through it: workspace (as caller-controlled as
  the rest, via `--workspace`, `WAFFLEBASE_WORKSPACE`, or a config profile),
  document, tab, cell. `fetch` truncates a path at `?` and resolves dot
  segments, so a raw `../..` would otherwise send the credentialed request
  outside the workspace prefix.
  Encoding alone is not sufficient for one case: `encodeURIComponent` does not
  escape `.`, and the URL spec resolves a segment that *is* `.` or `..`
  (`%2e` spellings included) however it is written. An identifier that is
  exactly a dot segment is therefore **rejected**, not escaped:
  `api-keys revoke ..` would otherwise resolve to `DELETE /workspaces/<ws>/`,
  the workspace-delete route, and its preview would have shown the
  unresolved `.../api-keys/..` instead. An *empty* identifier is rejected too,
  and for a reason that is not traversal: Nest runs Express with strict routing
  disabled, so `/documents/` matches the **collection** route — `docs get ""`
  would list every document rather than 404 on a missing id. The workspace is
  the one segment allowed to be empty (`workspaceSeg()`), because `''` is the
  state `resolveConfig` returns for a workspace nobody has chosen yet and every
  path built on it carries further segments (`/workspaces//documents` matches no
  route), so tolerating it costs nothing and refusing it would break every
  command and every offline preview with an `Invalid identifier ""`.
  The `import` / `upload` previews are the one envelope
  variation: they print a workspace-relative `path` (plus the parsed body and,
  for `slides`, the import report) rather than the `dry_run` / `url` envelope
  above, because their value is the parse result, not the URL. The identifier
  encoding is the same.
- `sheets cells get`: the printed URL is the endpoint the range selects —
  `?range=A1:C10` for a range, `/cells/A1` for a single ref, `/cells` for
  the whole tab.
- `docs content`, `docs export`: print the GET request that would be issued.
- `docs import` (default): preview both POST (create) and PUT (push content).
- `docs import --replace`: preview the PUT only; `--yes` is ignored — the
  destructive-action confirmation is skipped entirely, so the preview also
  works non-interactively. Same for `notes import` / `slides import`.

#### 8.3 Schema Introspection

`wafflebase schema` discovers command parameters and response shapes at
runtime, without consulting external documentation:

```bash
$ wafflebase schema sheets.cells.get
{
  "name": "sheets.cells.get",
  "description": "Get cells from a spreadsheet tab",
  "parameters": {
    "doc-id":  { "type": "string", "required": true,  "description": "Document ID" },
    "range":   { "type": "string", "required": false, "description": "Cell range (e.g. A1:C10)", "default": "all" },
    "--tab":   { "type": "string", "required": false, "description": "Tab ID", "default": "tab-1" }
  },
  "response": {
    "type": "array",
    "items": {
      "ref": "string",
      "value": "string | number | boolean | null",
      "formula": "string | null",
      "style": "object | null"
    }
  },
  "safety": "read-only",
  "aliases": ["cell.get", "cells.get", "sheet.cells.get", "sheet.cell.get", "sheets.cell.get"]
}

$ wafflebase schema cell.get      # → resolves to sheets.cells.get

$ wafflebase schema                # list all commands
{
  "commands": [
    { "name": "docs.list",          "safety": "read-only" },
    { "name": "docs.create",        "safety": "write" },
    { "name": "docs.delete",        "safety": "destructive" },
    { "name": "docs.content",       "safety": "read-only" },
    { "name": "docs.export",        "safety": "read-only" },
    { "name": "docs.import",        "safety": "write" },
    { "name": "sheets.cells.get",   "safety": "read-only" },
    { "name": "sheets.cells.set",   "safety": "write" },
    { "name": "sheets.cells.batch", "safety": "write" },
    { "name": "sheets.cells.delete","safety": "destructive" },
    ...
  ]
}
```

`docs.import` exposes a `variants` field that spells out the safety
split — `default → write` (creates a new document), `--replace given →
destructive` (overwrites in place):

```json
{
  "command": "docs.import",
  "safety": "write",
  "variants": [
    { "when": "default",         "safety": "write",       "creates":  "new document" },
    { "when": "--replace given", "safety": "destructive", "modifies": "existing document content" }
  ]
}
```

#### 8.4 Safety Annotations

| Level | Meaning | Agent behavior |
|-------|---------|----------------|
| `read-only` | No side effects | Safe to execute without confirmation |
| `write` | Creates or modifies data | Agent should confirm or use `--dry-run` first |
| `destructive` | Deletes data irreversibly | Agent must ask for user confirmation |

Safety levels are exposed via `wafflebase schema` and embedded in skill
definitions. This aligns with how Claude Code handles tool approval:
read-only tools run freely, write tools require user approval.

Schema entries by command (canonical plural names):

| Command                  | Safety        | Notes                                                  |
| ------------------------ | ------------- | ------------------------------------------------------ |
| `docs.list`              | read-only     | `--type` filter                                        |
| `docs.create`            | write         | `--type` flag                                          |
| `docs.get`               | read-only     | metadata only                                          |
| `docs.rename`            | write         |                                                        |
| `docs.delete`            | destructive   |                                                        |
| `docs.content`           | read-only     |                                                        |
| `docs.export`            | read-only     | file write is local                                    |
| `docs.import`            | write         | `safety` becomes `destructive` with `--replace`        |
| `docs.set-content`       | destructive   | whole-content replace, not a merge                     |
| `sheets.tabs.list`       | read-only     |                                                        |
| `sheets.tabs.create`     | write         |                                                        |
| `sheets.tabs.rename`     | write         |                                                        |
| `sheets.cells.get`       | read-only     |                                                        |
| `sheets.cells.set`       | write         |                                                        |
| `sheets.cells.batch`     | write         |                                                        |
| `sheets.cells.delete`    | destructive   |                                                        |
| `sheets.import`          | write         |                                                        |
| `sheets.export`          | read-only     |                                                        |
| `sheets.clear`           | destructive   | empties a range, keeps rows/columns                    |
| `sheets.insert`          | write         | rows or columns                                        |
| `sheets.delete`          | destructive   | rows or columns; `clear` is what empties a range        |
| `sheets.move`            | write         | `409` if it would split a merged range                 |
| `sheets.styles.get`      | read-only     |                                                        |
| `sheets.styles.set`      | destructive   | replaces the layer; omitted patches are deleted        |
| `sheets.sheet-style.get` | read-only     |                                                        |
| `sheets.sheet-style.set` | write         | `destructive` when the payload is `null`               |
| `sheets.column-styles.get` | read-only   |                                                        |
| `sheets.column-styles.set` | write       | `destructive` for a `null` value                       |
| `sheets.row-styles.get`  | read-only     |                                                        |
| `sheets.row-styles.set`  | write         | `destructive` for a `null` value                       |
| `sheets.column-widths.get` | read-only   |                                                        |
| `sheets.column-widths.set` | write       | `destructive` for a `null` value                       |
| `sheets.row-heights.get` | read-only     |                                                        |
| `sheets.row-heights.set` | write         | `destructive` for a `null` value                       |
| `sheets.freeze.get`      | read-only     |                                                        |
| `sheets.freeze.set`      | write         | an omitted key resets that axis to 0                   |
| `sheets.hidden.get`      | read-only     |                                                        |
| `sheets.hidden.set`      | write         | replaces the whole hidden set                          |
| `sheets.merges.get`      | read-only     |                                                        |
| `sheets.merges.set`      | destructive   | replaces the map; omitted anchors are unmerged         |
| `sheets.conditional-formats.get` | read-only |                                                    |
| `sheets.conditional-formats.set` | destructive | replaces the whole rule collection               |
| `sheets.data-validations.get` | read-only |                                                       |
| `sheets.data-validations.set` | destructive | replaces the whole rule collection                  |
| `sheets.charts.get`      | read-only     |                                                        |
| `sheets.charts.set`      | destructive   | replaces the collection; omitted charts are deleted    |
| `sheets.filter.get`      | read-only     |                                                        |
| `sheets.filter.set`      | write         | `destructive` when the payload is `null`               |
| `sheets.pivot.get`       | read-only     |                                                        |
| `sheets.pivot.set`       | write         | `destructive` when the payload is `null`               |
| `slides.list`            | read-only     | filtered to `type: slides`                             |
| `slides.create`          | write         |                                                        |
| `slides.get`             | read-only     | metadata only                                          |
| `slides.rename`          | write         |                                                        |
| `slides.delete`          | destructive   |                                                        |
| `slides.content`         | read-only     | `json` lossless; `md`/`text` text-only                 |
| `slides.export`          | read-only     | file write is local; PPTX only                         |
| `slides.import`          | write         | `safety` becomes `destructive` with `--replace`        |
| `slides.set-content`     | destructive   | whole-deck replace                                     |
| `notes.list`             | read-only     | filtered to `type: note`                               |
| `notes.create`           | write         |                                                        |
| `notes.get`              | read-only     | metadata only                                          |
| `notes.rename`           | write         |                                                        |
| `notes.delete`           | destructive   |                                                        |
| `notes.content`          | read-only     | `json` → `{content}`; `md`/`text` raw markdown         |
| `notes.export`           | read-only     | file write is local; Markdown only                     |
| `notes.import`           | write         | `safety` becomes `destructive` with `--replace`        |
| `notes.set-content`      | destructive   | whole-note replace                                     |
| `files.upload`           | write         | stores bytes verbatim; never parses                    |
| `files.download`         | read-only     | file write is local                                    |
| `files.list`             | read-only     | filtered to `file`/`pdf`/`image`                       |
| `files.get`              | read-only     | metadata only                                          |
| `files.rename`           | write         |                                                        |
| `files.delete`           | destructive   | deletes the stored blob too                            |
| `images.upload`          | write         | png/jpeg/gif/webp only, 10 MB cap                      |
| `images.get`             | read-only     | binary; file write is local                            |
| `images.delete`          | destructive   | deletes the stored image bytes                         |
| `login`                  | write         | OAuth login, writes session file                       |
| `logout`                 | write         | Deletes session file                                   |
| `status`                 | read-only     | Shows current auth state                               |
| `ctx.list`               | read-only     |                                                        |
| `ctx.switch`             | write         | Changes active workspace                               |

#### 8.5 Skills

Skills are Markdown files in `packages/cli/skills/` that serve as
self-contained instruction sets for AI agents. Each skill describes a
focused capability with command syntax, examples, and safety notes.
Agents load the relevant skill file and follow its instructions.

```markdown
---
name: sheets-read-cells
description: Read cell data from a Wafflebase spreadsheet
safety: read-only
tools:
  - wafflebase sheets cells get
  - wafflebase sheets tabs list
---

# Read Cells

## When to Use
When the user wants to read, inspect, or analyze spreadsheet data.

## Commands

### List tabs in a document
`wafflebase sheets tabs list <doc-id>`

### Read all cells
`wafflebase sheets cells get <doc-id>`

### Read a specific range
`wafflebase sheets cells get <doc-id> A1:C10 --tab <tab-id>`

## Safety
read-only — no data is modified. Safe to execute without user
confirmation.
```

#### 8.6 Recipes

Recipes are multi-step workflow templates that compose multiple CLI
commands. They live alongside skills, prefixed with `recipe-`:

```markdown
---
name: recipe-csv-pipeline
description: Import a CSV file, apply formulas, and export results
safety: write
---

1. Create a new document:
   `wafflebase docs create "Q1 Analysis"`
2. Import CSV data:
   `wafflebase sheets import <doc-id> data.csv`
3. Add summary formulas:
   `echo '{"E1":"Total","E2":"=SUM(B2:B100)"}' | wafflebase sheets cells batch <doc-id>`
4. Export results:
   `wafflebase sheets export <doc-id> - --file-format csv --range A1:E100`
```

#### 8.7 Agent Discovery Flow

```text
1. Agent loads skill/recipe files (bundled with CLI or fetched from repo)
2. Reads skill frontmatter to understand safety and available tools
3. Uses `wafflebase schema <command>` to check parameter details
4. For writes, runs with `--dry-run` to show intent to user
5. Executes the command, parses JSON output
6. On error, parses the JSON error response to decide next action
```

No special SDK, MCP server, or API wrapper is needed. The CLI itself
is the agent interface. This approach has key advantages:

- **Zero integration cost**: any agent that can run shell commands works.
- **Self-describing**: `schema` and skill files eliminate documentation lookup.
- **Safe by default**: safety annotations + dry-run prevent accidental data loss.
- **Composable**: recipes show agents how to chain commands for complex tasks.

### 9. Output Conventions

- Text results (json/md/text): stdout by default; `--out` redirects to
  a file. `--quiet` suppresses progress notices but preserves the body.
- Binary results (pdf/docx): positional `<file>`; `-` writes to stdout.
  `--force` is required to overwrite an existing target file. `--quiet`
  suppresses the "Exported to X" notice.
- Errors: a single JSON line on stderr with shape
  `{"error":{"code":"…","message":"…","command":"docs.content"}}`.
  `--quiet` does not suppress it — a non-zero exit with no bytes on
  either stream leaves the caller with nothing to act on. Only progress
  notices are display output; the envelope is the machine-readable
  failure signal, and stderr already survives stdout redirection.
  Every emitter builds it in `packages/cli/src/output/formatter.ts` —
  `outputError` for the throwing commands, `forwardUpstreamError` for a
  backend body that already *is* the envelope, and `errorEnvelope` /
  `upstreamErrorJson` for the paths that never throw — so "one line,
  attributed" holds on those too: the import/upload/download
  orchestrators, the backend-error passthroughs on `docs`/`notes`/`slides`
  content and export, `schema`'s lookup miss, and `ctx switch`. The prose
  they used to print was the first thing an agent hit and the one thing it
  could not parse. Their *prompts* and success notices stay prose: those go
  to a human at a terminal, and only failures are the machine-readable
  signal. `login` is the deliberate exception — it is an interactive,
  browser-driven flow whose failures are read by the person at the
  terminal, so it reports prose and carries the contract in its exit code
  instead (§10).
  A backend error body keeps its `code` and any extra context — agents
  branch on it — but never its `command`: attribution is the CLI's
  statement about which command *it* ran, so a server cannot forge it. A
  body that is *not* envelope-shaped still keeps its text: `message` (and
  a `message[]` of validation errors) is read off the top level too, which
  is where Nest's default `{statusCode, message, error}` puts it, so
  converting these paths to the envelope never costs the server's reason.
  What it *can* put on stderr is bounded, since it is upstream-controlled
  content: `code` is capped at 80 characters, `message` at 500, an HTML
  document in `message` is dropped for `HTTP <status>`, and sibling fields
  go once the whole body passes 4,000 bytes.

### 10. Error Matrix

| Case                                                | Exit | Code                | Message                                                            |
| --------------------------------------------------- | ---- | ------------------- | ------------------------------------------------------------------ |
| Unsupported `--format` value (any command)          | 1    | INVALID_FORMAT      | "Invalid --format \"<input>\". Use one of: <that command's list>." |
| `ctx list` / `ctx switch` without a session         | 1    | NOT_LOGGED_IN       | "Not logged in. Run `wafflebase login`."                           |
| Malformed `--data` / stdin JSON (`sheets cells batch`) | 1  | ERROR               | "Invalid JSON cell data in --data: <parser message>"               |
| `docs.content` on sheet document                    | 1    | TYPE_MISMATCH       | "Use `sheets cells get` for spreadsheet documents"                 |
| `sheets.cells.get` on doc                           | 1    | TYPE_MISMATCH       | "Use `docs content` for document files"                            |
| Malformed `--pages`                                 | 1    | INVALID_RANGE       | "Invalid page range: <input>"                                      |
| `--pages` exceeds page count                        | 0    | (stderr warn)       | "Page range clamped to 1-N"                                        |
| `--pages` with `--format docx`                      | 0    | (stderr warn)       | "DOCX has no page concept — exporting full document"               |
| `--replace` without `--yes` on a TTY                | (interactive prompt) | — | "This will replace content of <doc-id>. Continue? [y/N]"          |
| `--replace` without `--yes` on non-TTY              | 1    | CONFIRMATION_REQ    | "Refusing to overwrite without --yes in non-TTY"                   |
| `--replace --dry-run` without `--yes`               | 0    | —                   | (no prompt, no gate — a preview writes nothing)                     |
| Output file already exists                          | 1    | FILE_EXISTS         | "Refusing to overwrite <file>; pass --force"                       |
| `--out` / `<file>` directory missing                | 1    | PATH_NOT_FOUND      | (system message)                                                   |
| Backend 401, JWT session could not be refreshed     | 2    | SESSION_EXPIRED     | "Session expired. Run `wafflebase login`."                         |
| Backend error body *is* the envelope                | by status | (forwarded, bounded) | (the upstream's own code — e.g. SESSION_EXPIRED, TYPE_MISMATCH) |
| Backend error body is not the envelope              | by status | HTTP_ERROR (AUTH_ERROR on 401/403, SERVER_ERROR on 5xx) | "HTTP <status>" (+ ": <upstream message>" when the body had one) |
| Backend 401/403                                     | 2    | AUTH_ERROR          | "Authentication failed. Run `wafflebase login`."                   |
| Backend 5xx                                         | 2    | SERVER_ERROR        | caller's message, else "HTTP <status>"                             |
| Server unreachable (DNS, refused, TLS)              | 2    | NETWORK_ERROR       | "Request to <url> failed: <cause>" (URL + cause redacted)          |
| Workspace / document / tab / cell id is `.` or `..` | 1    | ERROR               | "Invalid path segment: \"..\"" (refused before any request is sent) |
| Unparseable `--server` / image URL                  | 1    | INVALID_URL         | "Invalid URL \"<url>\". Check --server / WAFFLEBASE_SERVER."       |
| Image `src` the CLI refuses to dereference          | 1    | IMAGE_URL_BLOCKED   | "Refusing to fetch …"                                              |
| Create returned 2xx with no `id`                    | 2    | INVALID_RESPONSE    | "Server did not return an id"                                      |
| Download returned 2xx with no bytes                 | 2    | HTTP_ERROR          | "HTTP <status> carried no file content for document <id>"          |
| `ctx switch` with no session / unknown workspace    | 1    | NOT_LOGGED_IN / NOT_FOUND | "Not logged in. Run `wafflebase login`." / "Workspace not found: <q>" |
| `schema` for an unknown command                     | 1    | NOT_FOUND           | "Unknown command: <name>"                                          |
| `login`: exchange / `me` / `workspaces` rejected    | 1/2  | (prose, status-derived exit) | "Token exchange failed (HTTP <status>). …"                 |
| Yorkie attach failure                               | 2    | YORKIE_ERROR        | "Failed to attach to document <id>"                                |
| DOCX parse failure                                  | 1    | INVALID_DOCX        | (DocxImporter message)                                             |
| Font CDN unreachable (DNS, refused, TLS)            | 2    | NETWORK_ERROR       | "Request to <url> failed: <cause>"                                 |
| Font download 401/403                               | 2    | AUTH_ERROR          | "Font download failed: <status> …"                                 |
| Font download 5xx                                   | 2    | SERVER_ERROR        | "Font download failed: <status> …"                                 |
| Font download 4xx (e.g. a 404 font URL)             | 1    | —                   | "Font download failed: <status> …"                                 |

There is deliberately no `UNAUTHORIZED` code: an auth failure is just a
backend response like any other. It reports `SESSION_EXPIRED` (the client's
own synthesized envelope, the one case the CLI knows is an auth failure) or
`AUTH_ERROR` — a single classifier for every command, so the code an agent
branches on never depends on which subcommand it ran.

**Every `!res.ok` goes through one guard.** `forwardUpstreamError`
(`packages/cli/src/output/formatter.ts`) is the whole non-OK branch for
commands that print through `outputError`, and `upstreamErrorJson` is its
twin for the import/upload/download paths that report through an injected
`io.stderr` and a returned exit code. Both apply the same rule — a body that
*is* the documented envelope is forwarded (bounded, see below), anything else
becomes the `HTTP_ERROR` / `AUTH_ERROR` / `SERVER_ERROR` envelope carrying
the upstream's own wording — and both take the exit class from the status
(`exitCodeForStatus`), so a `401 SESSION_EXPIRED` body does not read as a
user error just because it happens to be JSON. Before that, the `!res.ok`
branch was written out at each call site: six of them forwarded a real
envelope and the rest threw `new Error("HTTP <status>")`, which flattened
the client's own `SESSION_EXPIRED` to `{code: "ERROR"}` depending only on
which subcommand the agent happened to run.

**Ids are one path segment each.** Every id the client interpolates into a
request URL — the workspace, a document id, a tab id, a cell reference —
comes from argv, a config file, or a document an agent generated, and
`fetch` resolves `.` / `..` per the WHATWG URL rules. So each id is
percent-encoded (`seg()`, `packages/cli/src/client/url.ts`), which pins it
to the segment it was meant to fill: an id of
`../../../../workspaces/w/api-keys/k` is sent as a literal (escaped)
document id and 404s, instead of walking the request out of the
`/api/v1/workspaces/<ws>` base and issuing the command's own method, with
the session's bearer token, against an endpoint it never named.

Encoding cannot pin `.` and `..` themselves — `encodeURIComponent` leaves a
dot untouched and the URL parser resolves those two segments however they
are spelled — so they are the one id the client refuses outright. No real
id is ever a dot segment, so this is the matrix's `ERROR` row above: a
plain throw before the request is built (nothing reaches the network), and
therefore the classifier's default code rather than a code of its own.
Every other id, however strange, is encoded and sent.

Both rules cover `--dry-run` (§8.2), not just the request path: the preview
is a second URL builder (`printDryRun`, `packages/cli/src/client/dry-run.ts`),
and a preview that skipped the encoding would print a walked-out URL as "the
request that would be sent" — the one output an agent is most likely to copy
and run. The commands encode with the same `seg()` when they assemble a
previewed path, the printer encodes the workspace, and it re-checks the
assembled path for a dot segment, since after encoding there cannot be one.

The same reasoning applies wherever else an id or a name chooses something
outside the process:

- **A downloaded file lands on a name, not a path.** `files download` writes
  to the caller's `out` when they gave one — they typed a path, so a path is
  what they meant. Everything else is a *name*: both the server's
  `Content-Disposition` filename (derived from a document title) and the
  document id from argv are reduced with `basename` and refused if they are
  `.`, `..` or empty, falling back to `download` in the CWD
  (`packages/cli/src/files/download.ts`).
- **An image `src` in a document cannot aim an export at the local network.**
  `docs export` / `slides export` fetch every image inline from the operator's
  machine, and the `src` is content someone else may have written — so the
  fetcher gates every URL and every redirect hop, and pins each request to the
  addresses that gate approved. That guard is specified in full under
  §_Export image fetching_ above; it is the same rule as this section's,
  applied to a URL the document chose rather than an id the caller typed.
  A refusal is **not** fatal to the export — *for the CLI*. The exporters
  (`collectAndEmbedImages`, `DocxExporter.collectImages`, `exportPptx`) each
  take an `onImageError` reporter, and supplying it is what turns a per-image
  failure from fatal into a drop: the failed `src` is reported and that one
  image is left out (the DOCX run is omitted rather than left pointing at a
  relationship that was never written, and the PPTX element is skipped the way
  an unserializable chart already is). Every CLI export path passes
  `reportSkippedImage`, which prints one bounded, redacted line on stderr. One
  image the user cannot fix must not cost them the export they asked for —
  which is also what keeps a document full of URLs from an origin this install
  cannot reach exportable.
  The tolerance is opt-in precisely because those exporters are shared with
  the browser, which passes no reporter and keeps the old loud failure: there
  no SSRF guard makes a refusal ordinary, the export UI reports a thrown
  error, and a `console.warn` nobody reads would hand the user a silently
  incomplete download. The canonical write-up of that contract lives with the
  exporters, in
  [`docs/docs-pdf-export.md`](docs/docs-pdf-export.md#surviving-a-failed-image-onimageerror).
  One caveat worth stating plainly: the `catch` spans the decode and embed
  calls as well as the fetch, so for a caller that opted in, undecodable bytes
  are dropped as quietly as a refused host.

The rule is not CLI-only. The frontend talks to the same API with the user's
session, and interpolates route-param ids the same way, so it carries the same
primitive — literally the same one: `seg()` lives in `@wafflebase/core/url`
alongside `isSafeUrl`, the existing home for shared URL-safety rules, and both
`packages/cli/src/client/url.ts` and `packages/frontend/src/api/url.ts`
re-export it from there rather than keeping a second copy that can drift. It is
applied to **every**
browser API module that interpolates one — documents, workspaces, folders,
share links, datasources, files, analytics, Miro import and the sheet image
upload. A partially applied guard would be worse than none, because it reads
as covered: ids reach these modules from `useParams`, so a crafted link like
`/workspaces/..%2F..%2Fauth%2Flogout/settings` is enough (react-router
percent-decodes route params before handing them over). `url.test.ts` drives
one call per id-bearing route and asserts the normalized pathname still names
the route that was asked for.

**Forwarding is bounded, not byte-for-byte.** On the "body *is* the envelope"
row the `code` is the upstream's own — that is the contract, and it is never
rewritten or reclassified. The text around it is not echoed unchanged,
because a forwarded body is upstream-controlled content printed straight
into an agent's stderr, and the non-envelope path already refuses to quote a
stack trace or an HTML page. The same bounds therefore apply on the envelope
path (`safeEnvelope`, `packages/cli/src/output/formatter.ts`):

| Field                       | Bound                                                              |
| --------------------------- | ------------------------------------------------------------------ |
| `error.code`                | truncated at 80 characters — a code is an identifier, not prose     |
| `error.message`             | trimmed, truncated at 500 characters with a trailing `…`            |
| `error.message` that is HTML | replaced by `HTTP <status>` — a document is not a message           |
| sibling fields (`command`, request ids) | kept while the serialized body stays under 4,000 bytes; past that only `{code, message}` survives |

An `error.message` is a display string, not a payload to parse.

### 11. Design Principles

- **Stdin/stdout friendly**: support `-` as filename for piping.
- **Scriptable**: JSON output by default for machine consumption,
  `--quiet` to suppress non-essential output, exit codes for success
  (0) and failure (1/2).
- **Progressive disclosure**: simple commands for common tasks, flags
  for advanced options.
- **Offline-safe**: the CLI is stateless beyond local session/config;
  all state lives on the server.

## Risks and Mitigation

| Risk | Mitigation |
|------|-----------|
| CLI requires Node.js runtime | Acceptable for v1 — target users (developers, CI, AI agents) have Node.js. Can produce standalone binary later via `bun build --compile`. |
| CLI and API version drift | CLI includes `version` command; REST API is versioned (`/api/v1/`). CLI checks API compatibility on startup. |
| Skill files become outdated | Keep skills next to the CLI source. CI can validate that skill tool references match real commands. |
| Agents bypassing safety levels | Safety is advisory; the server enforces actual permissions via API key scopes. Safety annotations help agents make better decisions but are not access control. |
| `TextMeasurer` refactor regresses frontend layout | Visual regression run via `pnpm verify:browser:docker`; cross-implementation parity tests between Canvas and Fontkit measurers. |
| Fontkit and Canvas widths diverge enough to shift page break locations | Pixel rounding policy applied uniformly in the measurer adapter; golden tests for breakpoints near page edges. |
| CLI install size grows from `@wafflebase/docs` + fontkit + NotoKR fonts | Keep `PdfFonts` lazy (already lazy today); target ≤ 50 MB for the published CLI tarball. |
| Markdown loss surprises users | One-shot stderr notice per Markdown invocation; documented mapping table in this spec and skills. |
| Renaming top-level `cell/tab/import/export` breaks existing scripts | Document the migration table in the v0.3.7 release notes and the CLI README; expose `wafflebase migrate-help` to print the old → new mapping when an unrecognized command matches a known old name. |
| DOCX with images requires upload pipeline that does not exist yet | v1 imports embed inline images via `DocxImporter`'s `ImageUploader` interface using a base64 inline adapter. Real upload is deferred. |
| Page slicing nondeterminism | `paginateLayout` is deterministic; the only nondeterminism is font substitution, which the measurer warns about. |
| Browser doesn't open (SSH, container) | Print the URL so user can copy-paste. Future: add device flow. |
| Port conflict on localhost | Use random port with retry (up to 3 attempts). |
| Token file readable by other users | `0600` permissions on creation. Print warning if permissions are wrong. |
| Old config path confusion | Auto-copy to `~/.wafflebase/` on first run. Only new path consulted after. |
| Refresh token stolen from disk | Same risk as all file-based CLI token storage. Document in security notes. |
