# CLI OAuth Login Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add browser-based OAuth login to the CLI with JWT session storage and workspace context switching.

**Architecture:** Backend gets a CSRF+state store, CLI-mode OAuth redirect, and a code-to-token exchange endpoint. CLI starts a local HTTP server for the OAuth callback, stores JWT sessions in `~/.wafflebase/session.json`, and auto-refreshes tokens on 401. Config path migrates from `~/.config/wafflebase/` to `~/.wafflebase/`.

**Tech Stack:** NestJS (backend), Commander.js (CLI), Node.js `node:http` (local callback server), `open` package (browser launch)

**Design doc:** `docs/design/cli-oauth-login.md`

---

## Chunk 1: Backend — JWT Bearer header + CSRF store + CLI OAuth flow

### Task 1: Extend JwtStrategy to accept Bearer header

**Files:**
- Modify: `packages/backend/src/auth/jwt.strategy.ts`
- Modify: `packages/backend/src/auth/auth.controller.spec.ts`

- [ ] **Step 1: Write test for Bearer header extraction**

Add a test to `auth.controller.spec.ts` that verifies `GET /auth/me` returns 200 when an `Authorization: Bearer <jwt>` header is provided (not just cookies).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm backend test -- --testPathPattern auth.controller`
Expected: FAIL — JwtStrategy only extracts from cookies.

- [ ] **Step 3: Add Bearer header extractor to JwtStrategy**

In `jwt.strategy.ts`, add `ExtractJwt.fromAuthHeaderAsBearerToken()` as a second extractor:

```typescript
jwtFromRequest: ExtractJwt.fromExtractors([
  (request: Request) => request?.cookies?.wafflebase_session,
  ExtractJwt.fromAuthHeaderAsBearerToken(),
]),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm backend test -- --testPathPattern auth.controller`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/auth/jwt.strategy.ts packages/backend/src/auth/auth.controller.spec.ts
git commit -m "Accept Bearer header in JwtStrategy for CLI auth"
```

---

### Task 2: Create in-memory CSRF + code store

**Files:**
- Create: `packages/backend/src/auth/cli-auth.store.ts`
- Create: `packages/backend/src/auth/cli-auth.store.spec.ts`

- [ ] **Step 1: Write failing tests for the store**

Test `CliAuthStore` with:
- `createState(mode, port)` → returns `{ stateToken, csrf }` and stores entry with 5min TTL
- `consumeState(stateToken)` → returns `{ csrf, mode, port }` and deletes entry
- `consumeState(stateToken)` second call → returns `undefined` (single-use)
- `createCode(userId)` → returns code string, stores with 60s TTL
- `consumeCode(code)` → returns `userId`, deletes entry
- Expired entries return `undefined`

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm backend test -- --testPathPattern cli-auth.store`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement CliAuthStore**

```typescript
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

interface StateEntry {
  csrf: string;
  mode: string;
  port: number;
  expiresAt: number;
}

interface CodeEntry {
  userId: number;
  expiresAt: number;
}

@Injectable()
export class CliAuthStore {
  private states = new Map<string, StateEntry>();
  private codes = new Map<string, CodeEntry>();

  createState(mode: string, port: number): { stateToken: string; csrf: string } {
    const csrf = randomBytes(32).toString('base64url');
    const stateToken = randomBytes(32).toString('base64url');
    this.states.set(stateToken, {
      csrf,
      mode,
      port,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    this.cleanup();
    return { stateToken, csrf };
  }

  consumeState(stateToken: string): { csrf: string; mode: string; port: number } | undefined {
    const entry = this.states.get(stateToken);
    if (!entry || entry.expiresAt < Date.now()) {
      this.states.delete(stateToken);
      return undefined;
    }
    this.states.delete(stateToken);
    return { csrf: entry.csrf, mode: entry.mode, port: entry.port };
  }

  createCode(userId: number): string {
    const code = randomBytes(32).toString('base64url');
    this.codes.set(code, { userId, expiresAt: Date.now() + 60 * 1000 });
    this.cleanup();
    return code;
  }

  consumeCode(code: string): number | undefined {
    const entry = this.codes.get(code);
    if (!entry || entry.expiresAt < Date.now()) {
      this.codes.delete(code);
      return undefined;
    }
    this.codes.delete(code);
    return entry.userId;
  }

  private cleanup() {
    const now = Date.now();
    for (const [k, v] of this.states) if (v.expiresAt < now) this.states.delete(k);
    for (const [k, v] of this.codes) if (v.expiresAt < now) this.codes.delete(k);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm backend test -- --testPathPattern cli-auth.store`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/auth/cli-auth.store.ts packages/backend/src/auth/cli-auth.store.spec.ts
git commit -m "Add CliAuthStore for OAuth state and code management"
```

---

### Task 3: CLI-mode OAuth redirect + code exchange endpoint

**Files:**
- Modify: `packages/backend/src/auth/auth.controller.ts`
- Modify: `packages/backend/src/auth/auth.module.ts`
- Modify: `packages/backend/src/auth/github.strategy.ts`
- Modify: `packages/backend/src/auth/auth.controller.spec.ts`

- [ ] **Step 1: Write tests for CLI OAuth flow**

Test cases:
- `GET /auth/github?mode=cli&port=9876` → Passport redirects with state containing cli params
- `GET /auth/github/callback` with CLI state → redirects to `http://127.0.0.1:<port>/callback?code=<code>`
- `GET /auth/github/callback` with CLI state and invalid port → 400
- `POST /auth/cli/exchange` with valid code → returns `{ accessToken, refreshToken }`
- `POST /auth/cli/exchange` with invalid/expired code → 401
- `POST /auth/cli/exchange` same code twice → second call returns 401

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm backend test -- --testPathPattern auth.controller`
Expected: FAIL

- [ ] **Step 3: Modify GitHubStrategy to pass state**

Update `github.strategy.ts` to accept `state` passed from the controller. Override `authenticate()` to inject CLI params into the OAuth state.

- [ ] **Step 4: Add CLI redirect branch to callback**

In `auth.controller.ts`, after user creation in `githubAuthCallback`:
- Decode state, check for `mode === 'cli'`
- If CLI: validate port (1024-65535), create code via `CliAuthStore`, redirect to `http://127.0.0.1:<port>/callback?code=<code>`
- If web (default): existing cookie flow

- [ ] **Step 5: Add POST /auth/cli/exchange endpoint**

New endpoint in `auth.controller.ts`:
- Accepts `{ code }` body
- Calls `CliAuthStore.consumeCode(code)` → get userId
- Loads user, creates tokens
- Returns `{ accessToken, refreshToken }` as JSON (no cookies)

- [ ] **Step 6: Register CliAuthStore in AuthModule**

Add `CliAuthStore` to `providers` in `auth.module.ts`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm backend test -- --testPathPattern auth.controller`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/backend/src/auth/
git commit -m "Add CLI-mode OAuth redirect and code exchange endpoint"
```

---

### Task 4: Extend POST /auth/refresh for body fallback

**Files:**
- Modify: `packages/backend/src/auth/auth.controller.ts`
- Modify: `packages/backend/src/auth/auth.controller.spec.ts`

- [ ] **Step 1: Write tests for refresh body fallback**

Test cases:
- `POST /auth/refresh` with `{ refreshToken }` in body (no cookie) → returns `{ accessToken, refreshToken }` as JSON
- `POST /auth/refresh` with cookie (existing) → sets cookies, returns 200 (unchanged)
- `POST /auth/refresh` with invalid body token → 401

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm backend test -- --testPathPattern auth.controller`
Expected: FAIL

- [ ] **Step 3: Implement body fallback**

In the `refresh()` method:
1. Try cookie first (existing)
2. If no cookie, read `req.body?.refreshToken`
3. If token came from body, return `res.json({ accessToken, refreshToken })` instead of setting cookies

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm backend test -- --testPathPattern auth.controller`
Expected: PASS

- [ ] **Step 5: Run full backend test suite**

Run: `pnpm backend test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/auth/auth.controller.ts packages/backend/src/auth/auth.controller.spec.ts
git commit -m "Support refresh token in request body for CLI auth"
```

---

## Chunk 2: CLI — Config migration + session store

### Task 5: Migrate config path to ~/.wafflebase/

**Files:**
- Modify: `packages/cli/src/config/config.ts`
- Modify: `packages/cli/test/config.test.ts`

- [ ] **Step 1: Write tests for new config path**

Test cases:
- Default config path is `~/.wafflebase/config.yaml` (not `~/.config/wafflebase/`)
- If `~/.wafflebase/config.yaml` doesn't exist but `~/.config/wafflebase/config.yaml` does → copies file to new path, returns new path
- `WAFFLEBASE_CONFIG` env var still overrides

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm cli test`
Expected: FAIL — still using old path.

- [ ] **Step 3: Update getConfigPath and add migration**

Update `config.ts`:
- Change default path to `join(homedir(), '.wafflebase', 'config.yaml')`
- Add `migrateConfigIfNeeded()` that copies from old path if new doesn't exist
- Call migration in `resolveConfig()`

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm cli test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/config/config.ts packages/cli/test/config.test.ts
git commit -m "Migrate CLI config path to ~/.wafflebase/"
```

---

### Task 6: Create session store module

**Files:**
- Create: `packages/cli/src/config/session.ts`
- Create: `packages/cli/test/session.test.ts`

- [ ] **Step 1: Write failing tests for session store**

Test cases:
- `loadSession()` returns `null` when no file exists
- `saveSession(session)` writes `~/.wafflebase/session.json` with `0600` permissions
- `loadSession()` returns saved session with correct shape
- `clearSession()` deletes the file
- `isSessionExpired(session)` returns `true` when `expiresAt` is in the past
- `decodeJwtExpiry(token)` extracts `exp` from JWT payload → ISO 8601 string

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm cli test`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement session store**

```typescript
// session.ts
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export interface SessionUser {
  id: number;
  username: string;
  email: string;
  photo: string | null;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
}

export interface Session {
  server: string;
  user: SessionUser;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  activeWorkspace: string;
  workspaces: WorkspaceInfo[];
}

export function getSessionPath(): string {
  return join(homedir(), '.wafflebase', 'session.json');
}

export function loadSession(): Session | null {
  const path = getSessionPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Session;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  const path = getSessionPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(session, null, 2), { mode: 0o600 });
}

export function clearSession(): void {
  const path = getSessionPath();
  if (existsSync(path)) unlinkSync(path);
}

export function isSessionExpired(session: Session): boolean {
  return new Date(session.expiresAt).getTime() < Date.now();
}

export function decodeJwtExpiry(token: string): string {
  const payload = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString(),
  );
  return new Date(payload.exp * 1000).toISOString();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm cli test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/config/session.ts packages/cli/test/session.test.ts
git commit -m "Add CLI session store for JWT token persistence"
```

---

### Task 7: Integrate session into auth resolution + auto-refresh

**Files:**
- Modify: `packages/cli/src/config/config.ts`
- Modify: `packages/cli/src/client/http-client.ts`
- Modify: `packages/cli/src/commands/root.ts`

- [ ] **Step 1: Update resolveConfig to check session**

In `config.ts`, update `resolveConfig()` to load session when no API key is provided:
1. Flag/env `--api-key` → use API key
2. Session exists → use JWT from `session.json`, workspace from `activeWorkspace`
3. Config profile `api-key` → use API key
4. None → empty (commands will fail with auth error)

Add `authMode: 'api-key' | 'jwt' | 'none'` and `session?: Session` to `CliConfig`.

- [ ] **Step 2: Update HttpClient for JWT auth + auto-refresh**

In `http-client.ts`:
- When `authMode === 'jwt'`, send `Authorization: Bearer <accessToken>`
- On 401 response: call `POST /auth/refresh` with `{ refreshToken }` in body
- On refresh success: update session file, retry original request once
- On refresh failure: throw with "Session expired. Run `wafflebase login`."

- [ ] **Step 3: Update root.ts to pass session info through**

Update `getConfig()` to pass session data to `HttpClient`.

- [ ] **Step 4: Run tests**

Run: `pnpm cli test`
Expected: PASS — existing tests should still work (API key path unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/config/config.ts packages/cli/src/client/http-client.ts packages/cli/src/commands/root.ts
git commit -m "Integrate session-based JWT auth into CLI config and HTTP client"
```

---

## Chunk 3: CLI — Login, logout, status, ctx commands

### Task 8: Implement `wafflebase login`

**Files:**
- Create: `packages/cli/src/commands/login.ts`
- Modify: `packages/cli/src/bin.ts`

Dependencies: `open` package for browser launch.

- [ ] **Step 1: Add `open` dependency**

Run: `pnpm --filter @wafflebase/cli add open`

- [ ] **Step 2: Implement login command**

`login.ts`:
1. Check for existing session → prompt "Logged in as X. Continue?"
2. Start `node:http` server on `127.0.0.1` with random port (retry up to 3 times)
3. Build OAuth URL: `<server>/auth/github?mode=cli&port=<port>`
4. Print URL to stderr, open browser with `open`
5. Wait for `GET /callback?code=<code>` (30s timeout, reject other paths)
6. Call `POST <server>/auth/cli/exchange` with `{ code }` → get tokens
7. Serve success HTML, close server
8. Call `GET <server>/auth/me` with Bearer token → user info
9. Call `GET <server>/workspaces` with Bearer token → workspace list
10. If multiple workspaces → prompt selection with readline
11. Save session via `saveSession()`

- [ ] **Step 3: Register in bin.ts**

Replace `registerAuthCommand(program)` with `registerLoginCommand(program)`.

- [ ] **Step 4: Manual test**

Run with backend up: `pnpm --filter @wafflebase/cli exec tsx src/bin.ts login --server http://localhost:3000`
Expected: Browser opens, GitHub auth, tokens saved to `~/.wafflebase/session.json`.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/login.ts packages/cli/src/bin.ts packages/cli/package.json
git commit -m "Implement wafflebase login with browser OAuth flow"
```

---

### Task 9: Implement `wafflebase logout` and `wafflebase status`

**Files:**
- Create: `packages/cli/src/commands/logout.ts`
- Create: `packages/cli/src/commands/status.ts`
- Modify: `packages/cli/src/bin.ts`

- [ ] **Step 1: Implement logout**

`logout.ts`: call `clearSession()`, print "Logged out."

- [ ] **Step 2: Implement status**

`status.ts`:
- If no session: print "Not logged in. Run `wafflebase login`."
- If session: print user (username, email), server, active workspace, expiry status

Output format:
```
Logged in as hackerwins (susukang98@gmail.com)
Server:    http://localhost:3000
Workspace: hackerwins's Workspace (e98ff707-...)
Session:   valid (expires 2026-03-15T10:00:00Z)
```

- [ ] **Step 3: Register in bin.ts**

Add `registerLogoutCommand(program)` and `registerStatusCommand(program)`.

- [ ] **Step 4: Run typecheck**

Run: `pnpm cli typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/logout.ts packages/cli/src/commands/status.ts packages/cli/src/bin.ts
git commit -m "Add wafflebase logout and status commands"
```

---

### Task 10: Implement `wafflebase ctx list` and `wafflebase ctx switch`

**Files:**
- Create: `packages/cli/src/commands/ctx.ts`
- Create: `packages/cli/test/ctx.test.ts`
- Modify: `packages/cli/src/bin.ts`

- [ ] **Step 1: Write tests for ctx commands**

Test cases:
- `ctx list` with session → outputs workspace list with `*` next to active
- `ctx switch` with valid workspace name → updates `activeWorkspace` in session
- `ctx switch` with valid workspace ID → updates `activeWorkspace` in session
- `ctx switch` with prefix match → matches and switches
- `ctx switch` with unknown name → error

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm cli test`
Expected: FAIL

- [ ] **Step 3: Implement ctx commands**

`ctx.ts`:
- `ctx list`: load session, print workspaces with `*` marker on active
- `ctx switch <name|id>`: load session, find workspace by exact ID, exact name, or prefix match on name. Update `activeWorkspace`, save session.

- [ ] **Step 4: Register in bin.ts**

Add `registerCtxCommand(program)`.

- [ ] **Step 5: Run tests**

Run: `pnpm cli test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/ctx.ts packages/cli/test/ctx.test.ts packages/cli/src/bin.ts
git commit -m "Add wafflebase ctx list/switch for workspace context switching"
```

---

## Chunk 4: Cleanup + schema + docs + verification

### Task 11: Remove old `auth login`, update schema registry

**Files:**
- Delete: `packages/cli/src/commands/auth.ts`
- Modify: `packages/cli/src/schema/registry.ts`
- Modify: `packages/cli/src/bin.ts`

- [ ] **Step 1: Remove auth.ts and its import from bin.ts**

Delete `src/commands/auth.ts`. Remove `registerAuthCommand` import and call from `bin.ts`.

- [ ] **Step 2: Update schema registry**

Remove `auth.login` entry. Add entries for: `login`, `logout`, `status`, `ctx.list`, `ctx.switch`.

- [ ] **Step 3: Run typecheck + tests**

Run: `pnpm cli typecheck && pnpm cli test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/commands/auth.ts packages/cli/src/schema/registry.ts packages/cli/src/bin.ts
git commit -m "Replace auth login with top-level login/logout/status commands"
```

---

### Task 12: Update documentation

**Files:**
- Modify: `packages/docs/api/cli.md`
- Modify: `docs/design/rest-api-and-cli.md` (command tree section)

- [ ] **Step 1: Update CLI docs**

In `packages/docs/api/cli.md`:
- Replace "Quick Setup" `auth login` section with `wafflebase login` OAuth flow
- Add `logout` and `status` commands
- Add `ctx list` and `ctx switch` commands
- Update config path references to `~/.wafflebase/`

- [ ] **Step 2: Update design doc command tree**

In `docs/design/rest-api-and-cli.md` section 7.3, update the command tree to reflect:
- `login` / `logout` / `status` as top-level
- `ctx list` / `ctx switch` added
- `auth login` removed

- [ ] **Step 3: Commit**

```bash
git add packages/docs/api/cli.md docs/design/rest-api-and-cli.md
git commit -m "Update CLI docs for OAuth login and context switching"
```

---

### Task 13: Full verification

- [ ] **Step 1: Run pnpm verify:fast**

Run: `pnpm verify:fast`
Expected: All lint + tests pass.

- [ ] **Step 2: Manual e2e test (backend + Yorkie required)**

```bash
docker compose up -d
pnpm --filter @wafflebase/backend start:dev &

# Login
pnpm --filter @wafflebase/cli exec tsx src/bin.ts login

# Status
pnpm --filter @wafflebase/cli exec tsx src/bin.ts status

# Use session to list docs (no --api-key needed)
pnpm --filter @wafflebase/cli exec tsx src/bin.ts doc list

# Context switch
pnpm --filter @wafflebase/cli exec tsx src/bin.ts ctx list
pnpm --filter @wafflebase/cli exec tsx src/bin.ts ctx switch <workspace-name>

# Logout
pnpm --filter @wafflebase/cli exec tsx src/bin.ts logout
pnpm --filter @wafflebase/cli exec tsx src/bin.ts status  # "Not logged in"
```

- [ ] **Step 3: Update task file**

Mark all items complete in `docs/tasks/active/20260312-cli-todo.md`.

- [ ] **Step 4: Archive tasks**

Run: `pnpm tasks:archive && pnpm tasks:index`
