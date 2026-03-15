---
title: cli-oauth-login
target-version: 0.2.0
---

# CLI OAuth Login + Context Switching

## Summary

Add browser-based OAuth login to the Wafflebase CLI so users can authenticate
without manually creating API keys. The CLI starts a temporary local HTTP
server, opens the browser for GitHub OAuth, receives JWT tokens via localhost
redirect, and stores the session in `~/.wafflebase/session.json`. Users can
switch between workspaces with `wafflebase ctx switch`.

### Goals

- Let users authenticate the CLI by signing in with GitHub in the browser.
- Store JWT sessions locally in `~/.wafflebase/` with automatic token refresh.
- Support workspace context switching for users with multiple workspaces.
- Maintain backwards compatibility with API key authentication.
- Migrate CLI config from `~/.config/wafflebase/` to `~/.wafflebase/`.

### Non-Goals

- Multiple GitHub account switching (single account, multiple workspaces).
- Device flow or headless authentication (may be added later).
- Encrypting stored tokens (file permissions are sufficient for now).

## Proposal Details

### 1. Directory Structure

All CLI state moves to `~/.wafflebase/`:

```text
~/.wafflebase/
├── config.yaml        # Profile settings (server, API key, workspace)
└── session.json       # OAuth session (JWT tokens + active workspace)
```

Migration: if `~/.wafflebase/config.yaml` does not exist but
`~/.config/wafflebase/config.yaml` does, the CLI copies the file to
`~/.wafflebase/config.yaml` automatically and prints a notice. After migration,
only `~/.wafflebase/` is consulted.

Session file schema:

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
    { "id": "abc-123-...", "name": "Team Workspace" }
  ]
}
```

File permissions: `0600` (owner read/write only).

### 2. Login Flow

```text
wafflebase login
  │
  ├─ 1. If already logged in → prompt "Logged in as X. Continue? [Y/n]"
  ├─ 2. CLI starts temporary HTTP server on 127.0.0.1:<random-port>
  ├─ 3. Opens browser: GET /auth/github?mode=cli&port=<port>
  │     (also prints URL to terminal for copy-paste in headless environments)
  ├─ 4. GitHub OAuth consent screen (existing flow)
  ├─ 5. GitHub redirects to GET /auth/github/callback
  ├─ 6. Backend detects mode=cli in OAuth state:
  │     → redirects to http://127.0.0.1:<port>/callback?code=<short-lived-code>
  ├─ 7. CLI local server receives code, calls POST /auth/cli/exchange
  │     with { code } → receives { accessToken, refreshToken }
  ├─ 8. CLI local server serves success HTML page, shuts down
  ├─ 9. CLI calls GET /auth/me (with Bearer token) for user info
  ├─ 10. CLI calls GET /workspaces (with Bearer token) for workspace list
  ├─ 11. If multiple workspaces → interactive selection prompt
  │      If single workspace → auto-select
  └─ 12. Writes ~/.wafflebase/session.json
```

The local server binds to `127.0.0.1` only, accepts only `GET /callback`,
and shuts down after a single request with a 30-second timeout. On timeout
it prints: "Login timed out. Try again with `wafflebase login`."

`expiresAt` in the session file is derived by decoding the JWT payload
(base64) and reading the `exp` claim, converted to ISO 8601.

### 3. Backend Changes

#### 3.1 `JwtStrategy` — accept Bearer header

Extend `JwtStrategy` to extract JWTs from both the `wafflebase_session`
cookie (existing) and the `Authorization: Bearer` header (new fallback).
This enables CLI to call `/auth/me`, `/workspaces`, and other JWT-guarded
endpoints using the access token from the session file.

#### 3.2 `GET /auth/github` — pass CLI params through OAuth state

Extend the GitHub OAuth `state` parameter to carry `mode` and `port` when
`?mode=cli&port=<port>` is present.

CSRF mechanism: the backend generates a random 32-byte token per OAuth
request, stores it in a short-lived in-memory map (TTL 5 minutes, keyed by
the token value), and embeds it in the state. On callback, the backend
decodes the state, looks up the CSRF token in the map, and rejects if not
found or expired. The CLI does not need to know the CSRF token.

State encoding: `JSON.stringify({ csrf, mode, port })` → base64url.

#### 3.3 `GET /auth/github/callback` — CLI redirect branch

After successful OAuth and CSRF validation, check the decoded state for
`mode === 'cli'`:

- **Web (default):** set cookies, redirect to `FRONTEND_URL` (unchanged).
- **CLI:** generate a short-lived authorization code (random, TTL 60 seconds,
  stored in the same in-memory map), redirect to
  `http://127.0.0.1:<port>/callback?code=<auth-code>`.

Validation:
- `port` must be an integer in range `1024–65535`.
- Redirect host is always `127.0.0.1` (hardcoded, never from user input).

Tokens are NOT passed as URL query parameters. The short-lived code is
exchanged server-to-server in the next step.

#### 3.4 `POST /auth/cli/exchange` — code-to-token exchange

New endpoint. Accepts `{ code }` in the request body. Looks up the code in
the in-memory map, validates TTL, deletes it (single-use), and returns:

```json
{ "accessToken": "eyJ...", "refreshToken": "eyJ..." }
```

No authentication required (the code itself is the proof).

#### 3.5 `POST /auth/refresh` — body fallback

Current behavior: reads refresh token from `wafflebase_refresh` cookie.

Extended behavior:
1. Try cookie first (existing path).
2. If no cookie, read `{ refreshToken }` from request body
   (requires `Content-Type: application/json`).
3. If request came via body, return `{ accessToken, refreshToken }` as JSON
   instead of setting cookies.

This keeps web clients working unchanged while supporting CLI token refresh.

### 4. CLI Commands

#### Top-level auth commands

```bash
wafflebase login                  # OAuth browser login
wafflebase logout                 # Delete session.json
wafflebase status                 # Show login state, user, active workspace
```

#### Context switching

```bash
wafflebase ctx list               # List workspaces (* = active)
wafflebase ctx switch <name|id>   # Change active workspace
```

`ctx list` output:

```text
* e98ff707  hackerwins's Workspace
  abc-1234  Team Workspace
```

`ctx switch` updates `activeWorkspace` in the session file and prints the new
active workspace name.

#### Removed

`wafflebase auth login` (the old interactive API key setup) is replaced by
`wafflebase login`. API key configuration can still be done by editing
`~/.wafflebase/config.yaml` directly or via environment variables.

### 5. API Key Acquisition Paths

API keys provide a session-independent way to authenticate. Two paths exist:

**Path A: CLI (developers)**
```bash
wafflebase login                     # OAuth → JWT session
wafflebase api-key create "CI Key"   # create key using JWT
# Use key in CI: WAFFLEBASE_API_KEY=wfb_xxx
```

**Path B: Web UI (all users)**
```text
1. Sign in at the web app (GitHub OAuth)
2. Navigate to Workspace Settings (/w/:workspaceId/settings)
3. API Keys section → Create → copy the one-time key
4. Use in CLI: wafflebase --api-key wfb_xxx doc list
   Or in config.yaml / environment variable
```

The web UI already supports API key create, list, copy, and revoke
(owner-only, at `packages/frontend/src/app/workspaces/workspace-settings.tsx`).

### 6. Auth Resolution Order

When the CLI needs to authenticate a request, it checks sources in this order:

1. **Flag / env:** `--api-key` flag or `WAFFLEBASE_API_KEY` → sends
   `Authorization: Bearer wfb_...` (API key auth).
2. **Session:** `~/.wafflebase/session.json` exists and token is valid → sends
   `Authorization: Bearer <jwt>` (JWT auth). If expired, auto-refresh via
   `POST /auth/refresh` with body. If refresh fails, print error suggesting
   `wafflebase login`.
3. **Config profile:** `~/.wafflebase/config.yaml` profile has `api-key` →
   sends `Authorization: Bearer wfb_...` (API key auth).
4. **None:** error message with `Run "wafflebase login" to authenticate.`

Workspace resolution:
1. `--workspace` flag or `WAFFLEBASE_WORKSPACE` env.
2. Session → `activeWorkspace`.
3. Config profile → `workspace`.

### 7. Schema Registry Updates

New commands added to the schema registry:

| Command | Safety | Description |
|---------|--------|-------------|
| `login` | write | OAuth browser login, writes session file |
| `logout` | write | Deletes session file |
| `status` | read-only | Shows current auth state |
| `ctx.list` | read-only | Lists workspaces |
| `ctx.switch` | write | Changes active workspace |

### 8. Token Refresh Strategy

The CLI wraps HTTP requests with automatic refresh:

1. Make request with `Authorization: Bearer <accessToken>`.
2. If 401 response and session exists:
   a. Call `POST /auth/refresh` with `{ refreshToken }` in body.
   b. If success: update the session file with new tokens, retry original request.
   c. If failure: print "Session expired. Run `wafflebase login`." and exit.
3. At most one refresh attempt per request (no infinite loops).

### 9. Security Considerations

- **No tokens in URLs:** the OAuth callback passes a short-lived authorization
  code (not JWT tokens) as a query parameter. The code is exchanged for tokens
  via a server-to-server POST. This avoids token leakage through browser
  history, Referer headers, or server logs.
- **Token storage:** the session file is written with `0600` permissions.
  Tokens are stored in plaintext (same approach as `gh`, `supabase` CLIs).
- **Local server:** binds to `127.0.0.1` only (not `0.0.0.0`), accepts only
  `GET /callback` (rejects other paths), accepts a single request, has a
  30-second timeout, then shuts down.
- **CSRF protection:** backend generates a random 32-byte CSRF token per
  OAuth request, stores in a short-lived in-memory map (TTL 5 minutes), and
  validates on callback. Prevents OAuth state forgery.
- **Port validation:** backend only redirects to `127.0.0.1` with port in
  `1024–65535`. No open redirect risk.
- **Refresh token in body:** only returned as JSON when the request came via
  body with `Content-Type: application/json` (not cookie). Web clients
  continue using httpOnly cookies.

## Risks and Mitigation

| Risk | Mitigation |
|------|-----------|
| Browser doesn't open (SSH, container) | Print the URL so user can copy-paste. Future: add device flow. |
| Port conflict on localhost | Use random port with retry (up to 3 attempts). |
| Token file readable by other users | `0600` permissions on creation. Print warning if permissions are wrong. |
| Old config path confusion | Auto-copy to `~/.wafflebase/` on first run. Only new path consulted after. |
| Refresh token stolen from disk | Same risk as all file-based CLI token storage. Document in security notes. |
