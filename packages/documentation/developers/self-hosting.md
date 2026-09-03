# Self-Hosting

Wafflebase is open source (Apache-2.0) and designed to run on your own
infrastructure. Your data stays on your servers.

This page covers two different things, and they need different setups:

- **[Running it locally](#local-development)** — the dev stack on `localhost`,
  which works out of the box.
- **[Deploying it somewhere else](#production-deployment)** — which needs the
  frontend **rebuilt** with your own URLs, a different migration command, and a
  handful of variables the dev stack defaults for you.

> [!IMPORTANT]
> The frontend's API and Yorkie addresses are baked in **at build time**, and
> nothing supplies yours for you. `packages/frontend/.env.production` is **not**
> in the repository — it is a deployment's configuration, and `.gitignore`
> ignores it — so a `pnpm frontend build` with nothing configured falls back to
> the localhost `.env` beside it and bakes in `http://localhost:3000`. That
> build is visibly broken for anyone not sitting on the machine that made it,
> which is the intended failure: it points at nothing rather than quietly at
> somebody else's service. Supply your own values before you ship; see
> [Frontend build-time configuration](#frontend-build-time-configuration).

## Requirements

| Component | Version | Where it is pinned |
|-----------|---------|--------------------|
| Node.js | **22** | `.nvmrc` (`22`), both `Dockerfile` stages (`node:22-bookworm-slim`), and four of the five `.github/workflows/ci.yml` jobs (`node-version: 22.x`) — `verify-backend-image` sets up no Node, because it only builds and runs the container |
| pnpm | **10.5.2** | root `package.json` → `"packageManager": "pnpm@10.5.2"`; `Dockerfile` runs `corepack prepare pnpm@10.5.2 --activate` |
| PostgreSQL | **16** | `docker-compose.yaml` and the CI `verify-integration` service both use `postgres:16` |
| Docker Compose | **v2** (`docker compose`, not `docker-compose`) | `docker-compose.yaml` uses `profiles:` and `depends_on: … condition: service_completed_successfully` |

Notes on these numbers, so you can judge them:

- The root `package.json` has **no `engines` field**, so nothing enforces the
  Node floor at install time. 22 is simply the only version that is built and
  tested. If you use [nvm](https://github.com/nvm-sh/nvm), `nvm use` picks it up
  from `.nvmrc`.
- pnpm is required, not optional — the repository is a pnpm workspace
  (`pnpm-workspace.yaml`) and the lockfile is a pnpm lockfile. `corepack enable`
  will honour the pinned version automatically.
- **PostgreSQL 16 is what is pinned and tested, not a proven floor.** Nothing in
  the repository declares a minimum supported major, so an older server may work
  and is simply untested. Use 16 unless you have a reason not to.

## Local Development

```bash
git clone https://github.com/wafflebase/wafflebase.git
cd wafflebase
pnpm install
docker compose up -d                                    # infrastructure
pnpm backend migrate                                    # dev migrations only
pnpm dev                                                # three dev servers
```

`pnpm dev` runs three servers concurrently, not two:

| Server | Port | Script |
|--------|------|--------|
| Frontend (Vite) | `5173` | `pnpm frontend dev` |
| Backend (NestJS, watch mode) | `3000` | `pnpm backend start:dev` |
| Documentation (VitePress) | `5174` | `pnpm documentation dev` |

The documentation server is not decorative: `packages/frontend/vite.config.ts`
proxies `/docs` to `http://localhost:5174`, so skipping it makes the in-app
**Docs** link a dead route in development.

Open `http://localhost:5173`.

### What `docker compose up -d` starts

The **default** stack is four services — the compose file gives `profiles:` only
to the analytics services, so everything else starts unconditionally:

| Service | Image | Ports | Purpose |
|---------|-------|-------|---------|
| `postgres` | `postgres:16` | `5432` | User accounts, document metadata, share links, API keys |
| `yorkie` | `yorkieteam/yorkie:latest` | `8080`, `8081` | CRDT sync (`8080` RPC, `8081` profiling — started with `--pprof-enabled`) |
| `minio` | `minio/minio:RELEASE.2025-09-07T16-13-09Z` | `9000`, `9001` | S3-compatible blob storage (`9000` API, `9001` console) |
| `azurite` | `mcr.microsoft.com/azure-storage/azurite:3.35.0` | `10000` | Azure Blob emulator, used only by the lakehouse connector-parity test suite |

`azurite` exists for `RUN_LAKEHOUSE_INTEGRATION_TESTS`; it is inert if you never
run those tests. Start a subset if you would rather not run it:

```bash
docker compose up -d postgres yorkie minio
```

Four more services carry `profiles: ["analytics"]` and start only with that
opt-in profile: `kafka` and `starrocks`, plus two one-shot init containers that
create the topic and the database schema and then exit. See
[Analytics](#analytics-optional-1).

### `pnpm backend migrate` is a development command

```json
"migrate": "prisma migrate dev --name init"
```

`prisma migrate dev` is Prisma's **development** command: it can generate new
migration files from schema drift and can prompt to reset the database. Never
point it at production data. The repository itself prescribes the other command
for deployments — `Dockerfile:86` keeps the Prisma CLI in the runtime image so
that *"init containers can run `npx prisma migrate deploy`"*. See
[Running migrations](#running-migrations).

## Backend Environment Variables

Create a `.env` file in `packages/backend/`. `ConfigModule.forRoot()` is called
with `isGlobal: true` and **no `validationSchema`**, so there is no
whole-config check at boot and most values are not validated until the feature
that reads them runs. A few are still caught at startup, because the provider
that needs them reads them in its constructor and Nest instantiates providers
eagerly — `JWT_SECRET` is the notable one: `AuthService`'s constructor calls
`requireConfig('JWT_SECRET')`, which throws `JWT_SECRET is required` and the
process fails to start. Assume nothing else is checked for you.

### Required

| Variable | Notes |
|----------|-------|
| `DATABASE_URL` | Read by `prisma/schema.prisma` (`env("DATABASE_URL")`) |
| `JWT_SECRET` | Signs access tokens and Yorkie auth-webhook tokens **always**, and refresh tokens unless `JWT_REFRESH_SECRET` is set. Missing, it throws at boot |
| `GITHUB_CLIENT_ID` | GitHub OAuth app |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app |
| `GITHUB_CALLBACK_URL` | Also the deployment's declared public scheme — see [Cookies, TLS and the callback URL](#cookies-tls-and-the-callback-url) |
| `FRONTEND_URL` | Where the OAuth callback redirects back to, and the CORS origin |

```env
DATABASE_URL=postgresql://wafflebase:wafflebase@localhost:5432/wafflebase
JWT_SECRET=your_secret_here
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_CALLBACK_URL=http://localhost:3000/auth/github/callback
FRONTEND_URL=http://localhost:5173
```

### Server and runtime

| Variable | Default | Notes |
|----------|---------|-------|
| `PORT` | `3000` | The production image also sets `ENV PORT=3000` and `EXPOSE 3000` |
| `NODE_ENV` | unset | **Not just a logging switch.** `production` empties the MinIO storage fallbacks (`file/file.config.ts:8`, `image/image.config.ts:7`) and is the last-resort fallback for cookie `Secure`. The shipped image sets `NODE_ENV=production` |
| `LOG_LEVEL` | `info` | Pino level (`app.module.ts`) |
| `BACKEND_TRUST_PROXY` | `0` | Express `trust proxy` hop count. **Set to `1` when you run behind exactly one TLS-terminating proxy** (nginx, Cloudflare) so `req.ip` is the real client. Leaving it at `0` behind a proxy makes every request look like it came from the proxy, so the per-IP rate limiter buckets all traffic together; setting it *without* a real proxy in front lets any client spoof `X-Forwarded-For` and bypass those limits (`main.ts:39`) |
| `BACKEND_JSON_BODY_LIMIT` | `25mb` | Passed verbatim to `body-parser`. Raise it if CLI/docx content imports with large inline `data:` images are rejected |

### Sessions and cookies

| Variable | Default | Notes |
|----------|---------|-------|
| `JWT_REFRESH_SECRET` | falls back to `JWT_SECRET` | Set it to an independent value so a leaked access-token secret cannot mint refresh tokens |
| `JWT_ACCESS_EXPIRES_IN` | `1h` | |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | |
| `JWT_ACCESS_COOKIE_MAX_AGE_MS` | `3600000` | Cookie lifetime; keep it consistent with the token lifetime above |
| `JWT_REFRESH_COOKIE_MAX_AGE_MS` | `604800000` | |
| `COOKIE_SECURE` | derived | `true`/`1` or `false`/`0` overrides the scheme detection described [below](#cookies-tls-and-the-callback-url) |

### GitHub Enterprise

All four are optional; unset, login goes to public github.com. Set **all four**
to sign in against a GitHub Enterprise instance (`auth/github.strategy.ts`):

```env
GITHUB_AUTHORIZATION_URL=https://ghe.example.com/login/oauth/authorize
GITHUB_TOKEN_URL=https://ghe.example.com/login/oauth/access_token
GITHUB_USER_PROFILE_URL=https://ghe.example.com/api/v3/user
GITHUB_USER_EMAIL_URL=https://ghe.example.com/api/v3/user/emails
```

`GITHUB_USER_EMAIL_URL` is separate on purpose: with the `user:email` scope,
`passport-github2` otherwise fetches emails from `api.github.com`, where a GHE
token fails with *"Bad credentials"*.

### Yorkie

| Variable | Default | Notes |
|----------|---------|-------|
| `YORKIE_RPC_ADDR` | `http://localhost:8080` | Backend-side Yorkie address (`yorkie/yorkie.service.ts`, `yorkie/yorkie-admin.service.ts`). The **browser** uses `VITE_YORKIE_RPC_ADDR`, which is a different value on any real deployment |
| `YORKIE_PUBLIC_KEY` | unset | Yorkie project public key used by the backend SDK client |
| `YORKIE_SECRET_KEY` | unset | Project secret key. Enables "currently editing" presence on the documents list, **and** is the HMAC key that verifies the Yorkie event and auth webhooks (`document/yorkie-signature.guard.ts`). Without it the event webhook is rejected outright |
| `YORKIE_TOKEN_EXPIRES_IN` | `10m` | Lifetime of the short-lived token minted by `GET /auth/yorkie-token` for the auth webhook |
| `YORKIE_AUTH_WEBHOOK_ENFORCE` | `false` | `false` = shadow mode (log the decision, allow everything). `true` = actually deny. See [Yorkie auth webhook](#yorkie-auth-webhook-per-document-access-control) |

### Blob storage (S3-compatible)

Two **separate** buckets with independent settings. Outside production every
value falls back to the MinIO container; with `NODE_ENV=production` every
fallback is the empty string, so a misconfigured deployment fails on first use
with an explicit S3 error rather than silently authenticating with `minioadmin`.

```env
# Blob documents: PDFs, image documents, and any other uploaded file
FILE_STORAGE_ENDPOINT=http://localhost:9000
FILE_STORAGE_BUCKET=wafflebase-files
FILE_STORAGE_REGION=us-east-1
FILE_STORAGE_ACCESS_KEY=minioadmin
FILE_STORAGE_SECRET_KEY=minioadmin
FILE_STORAGE_PREFIX=                    # optional object-key prefix

# Images embedded inside documents (sheets, docs, slides, board)
IMAGE_STORAGE_ENDPOINT=http://localhost:9000
IMAGE_STORAGE_BUCKET=wafflebase-images
IMAGE_STORAGE_REGION=us-east-1
IMAGE_STORAGE_ACCESS_KEY=minioadmin
IMAGE_STORAGE_SECRET_KEY=minioadmin
IMAGE_STORAGE_PREFIX=                   # optional object-key prefix
```

See [Blob storage](#blob-storage) for bucket creation, key prefixes and upload
caps.

### Datasources and lakehouse

| Variable | Default | Notes |
|----------|---------|-------|
| `DATASOURCE_ENCRYPTION_KEY` | unset | 64 hex characters (32 bytes), AES-256-GCM. **Required on use, not at boot** — see the warning below |
| `LAKEHOUSE_ALLOWED_ENDPOINTS` | empty | Comma-separated **exact** HTTP(S) origins permitted as custom S3 / Azure / GCS-interop endpoints and Iceberg REST catalogs. Empty means none are allowed |
| `LAKEHOUSE_QUERY_TIMEOUT_MS` | `30000` | Integer in `100`–`300000`. Out of range is clamped to the nearest bound, a non-integer keeps the default; both warn — see the note below |
| `LAKEHOUSE_DUCKDB_MEMORY_LIMIT` | `512MB` | Must match `^[1-9][0-9]*(KB\|MB\|GB)$`; anything else silently falls back to the default. This one is **not** clamped and logs nothing — it takes a different code path from the four integers |
| `LAKEHOUSE_DUCKDB_THREADS` | `2` | Integer in `1`–`32`. Clamped, with a warning — see the note below |
| `LAKEHOUSE_DUCKDB_POOL_SIZE` | `2` | Integer in `1`–`8`. Clamped, with a warning. Operations stay globally serialized regardless, because DuckDB secrets are instance-global |
| `LAKEHOUSE_DUCKDB_MAX_PENDING` | `64` | Integer in `1`–`1000`. Clamped, with a warning |
| `LAKEHOUSE_DUCKDB_EXTENSION_DIR` | unset (`~/.duckdb`) | Where DuckDB keeps extension binaries. The production image sets it to `/app/.duckdb-extensions` and pre-populates it — see [DuckDB extensions](#duckdb-extensions-lakehouse) |
| `LAKEHOUSE_ALLOW_LOCAL_PATHS` | `false` | Trusted-admin feature: lets a lakehouse table point at the server's own filesystem |
| `LAKEHOUSE_LOCAL_ROOT` | unset | Required when local paths are enabled; paths outside it are rejected |

> [!NOTE]
> **Four of these are clamped, and say so; the memory limit is not.**
> `readBoundedInteger()` (`packages/backend/src/lakehouse/duckdb.service.ts`)
> reads `LAKEHOUSE_QUERY_TIMEOUT_MS`, `LAKEHOUSE_DUCKDB_THREADS`,
> `LAKEHOUSE_DUCKDB_POOL_SIZE` and `LAKEHOUSE_DUCKDB_MAX_PENDING`, and it does
> not treat the two kinds of bad input the same way:
>
> - **Out of range** is clamped to the nearest bound, so
>   `LAKEHOUSE_DUCKDB_THREADS=64` yields `32` — the maximum, not the default.
>   It warns: `LAKEHOUSE_DUCKDB_THREADS=64 is outside the supported range 1-32; using 32.`
> - **Not an integer** (`abc`, `2.5`, `Infinity`) keeps the default, because
>   there is no nearest bound for a value that is not a number. It warns:
>   `LAKEHOUSE_DUCKDB_THREADS="abc" is not an integer; using the default 2.`
>
> Unset, empty, or whitespace-only is neither of those: it is read as *not
> configured*, takes the default, and warns nothing. That is deliberate —
> `Number('') === 0` would otherwise clamp a bare `LAKEHOUSE_DUCKDB_THREADS=`
> down to the minimum.
>
> Both warnings name the variable, the value read and the value used, and are
> logged under the `DuckDbService` context. They are emitted once per setting
> during startup — these are field initializers on a singleton, so nothing is
> re-read on the query path. If an effective value does not look like the one
> you set, the startup log says which substitution happened.
>
> `LAKEHOUSE_DUCKDB_MEMORY_LIMIT` is the exception. It goes through
> `readMemoryLimit()`, which pattern-matches rather than bounds: a value that
> does not match falls back to `512MB` silently, with nothing logged. Check that
> one yourself.

> [!WARNING]
> **`DATASOURCE_ENCRYPTION_KEY` is required-on-use, not required-at-boot.**
> `datasource/crypto.util.ts` reads it inside `getKey()`, which only runs when a
> credential is encrypted or decrypted, and `app.module.ts` passes no
> `validationSchema`. A deployment that omits it therefore boots healthy, serves
> every other feature normally, and returns a 500 the first time somebody
> creates or opens a datasource or lakehouse connection. Set it if you intend to
> use those features — and verify it, because a wrong-length value fails the
> same way (`must be a 64-character hex string`).
>
> Generate one with `openssl rand -hex 32`. It is not rotatable without
> re-encrypting stored credentials.

### Miscellaneous

| Variable | Default | Notes |
|----------|---------|-------|
| `WAFFLEBASE_API_ORIGIN` | falls back to the origin of `GITHUB_CALLBACK_URL` | This deployment's own public API origin. Used to decide whether an absolute image URL stored inside a CRDT document is first-party before re-hosting it across a workspace boundary — the string comes out of the CRDT, where any collaborator could have written `https://attacker.example/api/v1/...`. **With neither this nor a callback URL set, only root-relative references are re-hosted** — safe, but a no-op on a deployment whose frontend was built with `VITE_BACKEND_API_URL` (as any non-localhost deployment must be), because those references are then absolute. If you set `VITE_BACKEND_API_URL`, set this to the same origin |
| `WAFFLEBASE_TEMPLATE_REVIEWER_IDS` | empty | Comma-separated user ids allowed to decide public template-gallery submissions. Empty means nobody, which keeps the public gallery shut. Non-positive-integer entries are dropped, so a typo cannot grant review authority to user `0` |

### Analytics (optional)

```env
# WAFFLEBASE_KAFKA_ADDRESSES=localhost:29092
# WAFFLEBASE_KAFKA_TOPIC=wafflebase-view-events
# WAFFLEBASE_STARROCKS_DSN=root:@tcp(localhost:9030)/wafflebase
```

Leave all three unset to disable analytics entirely. See
[Analytics](#analytics-optional-1).

## Frontend Build-Time Configuration

The frontend is a Vite static build. `import.meta.env.VITE_*` values are
**substituted into the bundle when you build it** — they are not read at
runtime, so setting them on the server that serves the files does nothing.

Exactly **one** env file is committed to the repository, and it is the localhost
one:

```env
# packages/frontend/.env — tracked, deliberately: it is what makes a fresh
# clone work under `pnpm dev` with no configuration at all
VITE_FRONTEND_BASENAME=/
VITE_BACKEND_API_URL=http://localhost:3000
VITE_YORKIE_RPC_ADDR=http://localhost:8080
VITE_YORKIE_PUBLIC_KEY=
```

`pnpm frontend build` runs `vite build`, which uses mode `production`, and Vite
loads `.env`, `.env.local`, `.env.production`, `.env.production.local` in that
order with each overriding the ones before it. Only the **first** of those four
is in the repository: `.env.production` is gitignored (root `.gitignore`) and
`*.local` is too (`packages/frontend/.gitignore`), because those are a
*deployment's* configuration rather than the project's.

What ships instead is a template, `packages/frontend/.env.production.example`,
documenting each variable. Vite never loads it — `.example` is not a mode — so
copying or otherwise supplying the values is a step you have to take.

> [!WARNING]
> **An unconfigured production build is broken, and that is the design.** With
> no `.env.production` and no environment variables, the four localhost values
> above are what get baked in, so every visitor's browser calls
> `http://localhost:3000` and `http://localhost:8080` — their own machine, not
> your server. The page loads and then fails to sign in or sync.
>
> This replaced a worse failure. A committed `.env.production` used to carry
> wafflebase's own backend, Yorkie project and Google Analytics property, so an
> unconfigured build worked well enough to deploy while sending your users'
> traffic to us. If you are building from a checkout older than that change,
> check `packages/frontend/.env.production` before you trust the output.
>
> Verify a build either way: `grep -rl api.wafflebase.io packages/frontend/dist`
> must print nothing. Grep for **your backend's** host to confirm the positive
> case. Do *not* grep for `api.yorkie.dev` — it is the yorkie-js-sdk's own
> built-in default `rpcAddr` and is present in the vendor bundle regardless of
> how you configured the build, so it is always a false positive.

Three ways to supply the values, best first (note that this is not the
precedence order — environment variables outrank every file, including
`.env.production.local`):

1. **`packages/frontend/.env.production.local`** — the highest-precedence file,
   and gitignored, so your deployment's URLs never land in a commit. This is the
   recommended way. Beware `.env.local`, the intuitive filename: it ranks
   **below** `.env.production` and will not override it.
2. **Environment variables on the build command** — Vite applies any `VITE_`
   variable already in `process.env` after every file, so these beat all four.
   Best for CI, where nothing is written to disk. This is what wafflebase's own
   deploy does; see the "Install and Build" step in
   `.github/workflows/publish-ghpage.yml`, which reads them from repository
   variables and fails the build when the required ones are missing.
3. **Copying `packages/frontend/.env.production.example` to
   `.env.production`** and filling it in — also gitignored, so it will not show
   up as a repository modification or conflict on an upstream merge.

Leaving a variable out is not an error and nothing prompts you. The four in the
table below that appear in `.env` fall back to their **localhost** values;
everything else, `VITE_GA_ID` included, is genuinely unset because no committed
file sets it.

| Variable | Required for a non-localhost deployment | Notes |
|----------|------------------------------------------|-------|
| `VITE_BACKEND_API_URL` | **Yes** | Prefixed onto every backend call (~60 call sites), including the GitHub login link and the notifications SSE stream. Must be the public origin of your backend |
| `VITE_YORKIE_RPC_ADDR` | **Yes** | Passed to the browser's Yorkie client (`PrivateRoute.tsx`, `shared-document.tsx`, `apply-imported-content.ts`). This is the address **browsers** reach Yorkie at, which is not the same value as the backend's `YORKIE_RPC_ADDR` unless both run on the same host |
| `VITE_YORKIE_PUBLIC_KEY` | If your Yorkie project requires it | The Yorkie project public key, passed as the client `apiKey` |
| `VITE_FRONTEND_BASENAME` | Only if not served at `/` | React Router basename (`App.tsx`) |
| `VITE_GA_ID` | **No — leave it unset** | Google Analytics measurement ID. Unset is the correct default and needs no action: no committed file sets it, and `gaSnippet()` in `packages/frontend/vite.config.ts` emits no gtag.js when it is missing or empty. Set it only if the property is yours |
| `VITE_DEMO_SHARED_TOKEN` | No | Share token backing the sheet demo on the marketing homepage |
| `VITE_DEMO_DOC_SHARED_TOKEN` | No | Same, for the docs demo |
| `VITE_DEMO_SLIDES_SHARED_TOKEN` | No | Same, for the slides demo |

Build with your own values:

```bash
VITE_BACKEND_API_URL=https://api.example.com \
VITE_YORKIE_RPC_ADDR=https://yorkie.example.com \
VITE_YORKIE_PUBLIC_KEY=your_yorkie_public_key \
pnpm frontend build          # → packages/frontend/dist
```

`VITE_GA_ID` is absent from that list on purpose — unset already means no
analytics. Add it only to opt in.

Or write the same three to `packages/frontend/.env.production.local`, the last
file `vite build` loads, or to `packages/frontend/.env.production`. Both are
gitignored; `.env.production.example` is the template for either.

To ship the in-app documentation alongside the app, use the root script instead
— it builds the frontend and VitePress and copies the latter to `dist/docs`,
matching the `/docs` route the dev server proxies:

```bash
pnpm build:all
```

The documentation site is a **second** Vite build with its own configuration,
and it reads one variable of its own: `packages/documentation/.vitepress/config.ts`
loads `VITE_GA_ID` from `packages/documentation/` and injects gtag.js into every
docs page when it is set. That directory's `.env.production` is gitignored for
the same reason as the frontend's — it used to be committed carrying
wafflebase's measurement ID, so any `pnpm build:all` reported into our analytics
property — and `packages/documentation/.env.production.example` is its template.
Unset, the docs site emits no analytics either.

Because a `VITE_`-prefixed environment variable outranks every `.env*` file in
both builds, one variable on the command covers both:

```bash
VITE_GA_ID=G-YOUR-OWN-ID pnpm build:all    # opt in for app + docs
pnpm build:all                             # no analytics anywhere
```

Serve `packages/frontend/dist` from any static host or CDN, with a SPA fallback
to `index.html`.

## GitHub OAuth Setup

1. Go to [GitHub Developer Settings](https://github.com/settings/developers).
2. Click **New OAuth App**.
3. Set the **Authorization callback URL** to
   `https://your-domain/auth/github/callback` — the same value you give
   `GITHUB_CALLBACK_URL`.
4. Copy the Client ID and Client Secret into `packages/backend/.env`.

### Cookies, TLS and the callback URL

`GITHUB_CALLBACK_URL` does double duty: it is where GitHub sends the browser
back, and it is how the backend learns **its own public scheme**. That scheme
decides whether the login and session cookies carry `Secure`, and with it the
`__Host-` prefix — the property that stops anything on a sibling subdomain from
planting a session or CSRF-state cookie on your origin.

`isSecureCookie()` (`auth/oauth-state.ts`) resolves it in this order:

1. `COOKIE_SECURE=true`/`1` → secure. `false`/`0` → not secure.
2. `GITHUB_CALLBACK_URL` starts with `https://` → secure; `http://` → not
   secure.
3. Otherwise (no callback URL configured at all) → `NODE_ENV === 'production'`.

Three consequences worth knowing before you deploy:

- **The shipped Docker image sets `NODE_ENV=production` while this page's dev
  example hands out an `http://` callback URL.** That combination used to
  produce `Secure`/`__Host-` cookies on a plain-http origin, which browsers
  discard on arrival — a login that fails because the callback can never find
  its own state cookie. Reading the callback scheme first is what fixes it, so
  **the callback URL must be accurate**: it is now the value that decides.
- **TLS terminating at a proxy while `GITHUB_CALLBACK_URL` is still `http://`**
  reads your https origin as cleartext and drops `Secure` from the *session*
  cookie. Fix it by setting `GITHUB_CALLBACK_URL` to the https URL your users
  actually reach; `COOKIE_SECURE=true` states it directly if you cannot. Running
  `NODE_ENV=production` with a non-loopback `http://` callback URL logs a
  warning at the first login for this reason.
- **`wafflebase login` (the CLI) refuses a plain-http non-loopback origin.** CLI
  sign-in answers `400 Command-line sign-in requires an https server` unless it
  can see that its consent cookie is trustworthy. `cliLoginAvailable()`
  (`packages/backend/src/auth/github-auth.guard.ts`) allows it when *either*
  the cookies are already `Secure` — an `https://` callback URL, or
  `COOKIE_SECURE=true` — *or* the callback URL is a loopback one
  (`localhost`, `127.0.0.1`, `[::1]`, `*.localhost`). An `http://` non-loopback
  callback URL is the case it refuses.
- **Leaving `GITHUB_CALLBACK_URL` unset does not refuse it — under
  `NODE_ENV=production` it allows it,** which is the shipped container's
  default (`Dockerfile` sets `NODE_ENV=production`). With no callback URL and
  no `COOKIE_SECURE`, `isSecureCookie()`
  (`packages/backend/src/auth/oauth-state.ts`) falls through to
  `NODE_ENV === 'production'` and reads the origin as https, so the consent
  cookie goes out `Secure` and CLI sign-in is available. That is deliberate
  rather than an oversight: if the origin turns out to be cleartext the browser
  discards a `Secure` `__Host-` cookie, so the consent gate fails closed and
  the login cannot complete. The practical consequence is that you cannot infer
  your deployment's scheme from whether `wafflebase login` is offered — set
  `GITHUB_CALLBACK_URL` to the https URL your users actually reach and the
  question does not arise.

Turning `Secure` on renames the session cookies (`wafflebase_session` →
`__Host-wafflebase_session`), and the unprefixed name is deliberately not
honoured afterwards. Existing sessions stop being recognised the first time you
flip it and users are sent through the login again; logout expires both shapes,
so nothing stale is left behind.

## Production Deployment

### Container image

A production `Dockerfile` sits at the repository root. It is a two-stage build —
stage 1 builds `@wafflebase/core`, `sheets`, `docs`, `slides` and the backend on
the build host; stage 2 installs production dependencies only, generates the
Prisma client for the target platform, and copies the built artifacts in.

```bash
docker build -t wafflebase-backend .
docker run --env-file packages/backend/.env -p 3000:3000 wafflebase-backend
```

The image:

- runs `node dist/main` from `/app/packages/backend`,
- sets `ENV NODE_ENV=production` — **which empties the MinIO storage
  defaults**, so `FILE_STORAGE_*` and `IMAGE_STORAGE_*` must be set explicitly
  or uploads fail on first use,
- sets `ENV PORT=3000` and `EXPOSE 3000`,
- sets `ENV LAKEHOUSE_DUCKDB_EXTENSION_DIR=/app/.duckdb-extensions` and
  pre-populates it (see [DuckDB extensions](#duckdb-extensions-lakehouse)),
- keeps the Prisma CLI available so an init container can run migrations,
- is **glibc-based (`node:22-bookworm-slim`), not Alpine**, on purpose: DuckDB
  publishes no `delta` extension build for `linux_arm64_musl`.

The image contains the **backend only**. Build and serve the frontend separately
(see [Frontend build-time configuration](#frontend-build-time-configuration)),
and run PostgreSQL and Yorkie yourself.

Health endpoints for your orchestrator: `GET /health` and `GET /health/ready`.

### Running migrations

Use `prisma migrate deploy` — it applies pending migrations and nothing else.

```bash
# From a checkout
pnpm --filter @wafflebase/backend exec prisma migrate deploy

# Or, in the image (an init container / one-shot job)
cd /app/packages/backend && npx prisma@6.6.0 migrate deploy
```

Do **not** use `pnpm backend migrate` here — it runs `prisma migrate dev`, which
is interactive, can author new migration files from schema drift, and can offer
to reset the database.

Migrations must complete before the new image serves traffic.

### Behind a TLS-terminating proxy

- Set `BACKEND_TRUST_PROXY=1` (or your real hop count) so `req.ip` is the client
  address rather than the proxy's. The rate limiter and audit logging key off
  it.
- Set `GITHUB_CALLBACK_URL` to the **https** URL users reach, or
  `COOKIE_SECURE=true`. See
  [Cookies, TLS and the callback URL](#cookies-tls-and-the-callback-url).
- Set `FRONTEND_URL` to the frontend's public origin (CORS + post-login
  redirect), and build the frontend with a matching `VITE_BACKEND_API_URL`.
- Set `WAFFLEBASE_API_ORIGIN` to the backend's public origin, since
  `VITE_BACKEND_API_URL` makes stored image references absolute.

## Yorkie Auth Webhook (per-document access control)

Document content lives in Yorkie, not in this backend — so **until you register
the auth webhook, the Yorkie layer enforces no per-document access control at
all.** Anyone who can reach your Yorkie server and knows or guesses a document
key can attach to it. Registering the webhook is what makes workspace membership
and share-link roles apply at the sync layer.

`POST /internal/yorkie/auth` is HMAC-verified with `YORKIE_SECRET_KEY` and reads
the caller's identity from a short-lived backend-minted token the frontend
supplies via Yorkie's `authTokenInjector`. The auth webhook is a **per-project**
Yorkie setting, not a server flag:

```bash
yorkie login --rpc-addr localhost:8080          # once, as the project admin
yorkie project update <project> \
  --auth-webhook-url https://api.example.com/internal/yorkie/auth \
  --auth-webhook-method-add AttachDocument \
  --auth-webhook-method-add PushPull \
  --auth-webhook-method-add Watch \
  --auth-webhook-method-add DetachDocument \
  --auth-webhook-method-add Broadcast \
  --auth-webhook-method-add RemoveDocument \
  --auth-webhook-method-add ListRevisions \
  --auth-webhook-method-add GetRevision \
  --auth-webhook-method-add RestoreRevision
```

Then roll it out:

1. Deploy with `YORKIE_AUTH_WEBHOOK_ENFORCE=false` (**shadow mode**) — the
   backend computes and logs the decision it *would* make but allows every
   request.
2. Confirm the logs show no false denials.
3. Flip to `YORKIE_AUTH_WEBHOOK_ENFORCE=true`.

Unregister with `--auth-webhook-method-rm ALL` to disable.

> [!CAUTION]
> **Shadow mode is not protection.** A deployment that registers the methods but
> leaves `YORKIE_AUTH_WEBHOOK_ENFORCE=false` allows everything regardless of the
> computed decision — including an anonymous share-link viewer listing, reading
> and restoring a document's full revision history. Both steps are required.

> [!WARNING]
> **Do not register `CreateRevision`.** Yorkie calls the webhook for it with
> `attributes: null` — no document key, no verb — for every caller, and the
> decision logic fails closed on a document-scoped method with no attributes.
> Registering it therefore denies `CreateRevision` to *everyone*, the document
> owner included, and "Name current version" stops working. Leaving it
> unregistered leaves it ungated: any attached client can create a revision.
> That is a nuisance rather than a destructive hole, and closing it needs an
> upstream fix.

`ListRevisions` and `GetRevision` are gated more strictly than their Yorkie verb
suggests. Yorkie sends them with verb `r`, which a share-link **viewer** passes;
but a revision snapshot exposes every past state of the document, including
content deleted before the link was shared. So the backend requires the same
editor-or-member authority a write does for those two. Workspace members and
share-link *editors* keep their history; only viewers lose it. Ordinary reads
(`PushPull`, `Watch`) are untouched.

The public template gallery additionally **requires**
`YORKIE_AUTH_WEBHOOK_ENFORCE=true`, and refuses to open otherwise: in shadow
mode the preview token a public template card hands every visitor would also
grant *write* access to the underlying document.

## Blob Storage

Uploaded files and embedded images are stored as blobs in an S3-compatible
object store rather than in Yorkie. They use **two separate buckets** with
independent settings:

- **`FILE_STORAGE_*`** — blob documents: PDFs, image documents, and any other
  uploaded file (default bucket `wafflebase-files`).
- **`IMAGE_STORAGE_*`** — images embedded inside sheets, docs, slides and boards
  (default bucket `wafflebase-images`).

If `FILE_STORAGE_*` is misconfigured, file upload is unavailable; if
`IMAGE_STORAGE_*` is, image insertion is — in each case the rest of the app runs
normally.

### Buckets are created on demand

Both services try `HeadBucket` on startup and fall back to `CreateBucket`
(`file/file.service.ts`, `image/image.service.ts`). A failure is logged as a
warning and the module boots anyway, so a missing bucket does not stop the
server — it surfaces on the first upload.

Consequently your S3 credentials need **either** `s3:CreateBucket`, **or**
pre-created buckets with `HeadBucket` permission. Pre-creating them and granting
only object-level access is the tighter option.

### Key prefixes

`FILE_STORAGE_PREFIX` / `IMAGE_STORAGE_PREFIX` namespace objects inside a bucket
shared with another application; empty (the default) keeps keys at the bucket
root. Surrounding `/` are trimmed. **Treat them as fixed for the deployment's
lifetime** — changing one after uploads orphans every object already stored
under the old prefix. The image prefix composes outside the per-workspace key
prefix.

### Upload size caps

There are two upload paths with different caps. They are separate subsystems,
not alternatives:

| Path | Endpoint | Cap | Types |
|------|----------|-----|-------|
| Blob documents (drag-and-drop onto the documents list; `POST /api/v1/.../files`) | `POST /files`, `POST /api/v1/workspaces/:wid/files` | **50 MB**, but **25 MB** when the upload looks like an image | Any file. The image cap keys off the MIME **and** the extension, so renaming does not evade it |
| Images embedded in a document | `POST /images` (the browser path), `POST /api/v1/workspaces/:wid/images` (API keys) | **10 MB** | `image/png`, `image/jpeg`, `image/gif`, `image/webp` only |

Both numbers are correct — they belong to two different features, and neither
overrides the other.

The 50 MB figure is also the Multer parsing limit on the blob-document routes,
so an oversized body is rejected during parsing rather than buffered whole, and
the frontend mirrors the same rule at enqueue time (`app/documents/file-meta.ts`)
so a multi-gigabyte file never crosses the wire at all. On the embedded-image
path the frontend downscales an oversized image before uploading rather than
refusing it outright, so the 10 MB limit is usually invisible to users.

The 10 MB is enforced at a different point on each of the two image routes.
`/api/v1/.../images` sets it as a Multer `limits.fileSize`, so an oversized body
is rejected during parsing; the browser's `POST /images` uses a bare
`FileInterceptor` with no limit, so the body is buffered whole and
`ImageService.upload()` rejects it afterwards with `File too large (max 10 MB)`.
The cap is the same either way — only the memory an oversized request costs
differs.

Neither cap is configurable by an environment variable; both are compile-time
constants. If you front the backend with a proxy, make sure its own body limit
is at least 50 MB or it will reject uploads the application would accept.

## Analytics (optional)

Wafflebase can record **Share Link view analytics** — views, unique/returning
visitors, dwell time, and a per-link breakdown — surfaced on a per-document and
per-workspace dashboard. This is entirely optional and **off by default**: with
`WAFFLEBASE_KAFKA_ADDRESSES`, `WAFFLEBASE_KAFKA_TOPIC` and
`WAFFLEBASE_STARROCKS_DSN` unset, the whole pipeline is a no-op and the
dashboard shows "not enabled". The rest of the app is unaffected.

The pipeline reuses the same stack Yorkie ships for its own analytics:

- **Kafka** — the backend batches client view events (via a `sendBeacon`
  endpoint) onto a Kafka topic.
- **StarRocks** — a Routine Load ingests the topic into a
  `wafflebase.view_events` table; the dashboard queries it back over the MySQL
  wire protocol.

Both run as an **opt-in Docker Compose profile** kept out of the default stack:

```bash
docker compose --profile analytics up -d
```

That starts `kafka` (`29092`), `starrocks` (`8030`, `9030`, `8040`) and two
one-shot init containers that create the topic, database, table and routine
load — alongside the default `postgres` / `yorkie` / `minio` / `azurite`
services.

Then point the backend at them:

```env
WAFFLEBASE_KAFKA_ADDRESSES=localhost:29092
WAFFLEBASE_KAFKA_TOPIC=wafflebase-view-events
WAFFLEBASE_STARROCKS_DSN=root:@tcp(localhost:9030)/wafflebase
```

Open a document through a share link to emit events, then visit the workspace
**Analytics** tab. Pointing these at brokers that are not running just produces
connection errors — leave them commented out until the profile is up.

## DuckDB Extensions (lakehouse)

The lakehouse connector reads Iceberg and Delta tables from object storage
through an embedded DuckDB, which needs four DuckDB extensions — `httpfs`,
`iceberg`, `delta`, `azure` — plus `avro`, which `iceberg` pulls in. DuckDB
normally downloads these from `extensions.duckdb.org` on first use.

The production image downloads them **at build time** into
`LAKEHOUSE_DUCKDB_EXTENSION_DIR` (`/app/.duckdb-extensions`) for the platform it
will run on, so a deployment needs no egress to `extensions.duckdb.org`. The
build step also `LOAD`s each one, so a platform whose binary is missing fails
the build instead of production. Cost: roughly 170 MB of extension binaries,
most of it `delta` (73 MB) and `iceberg` (44 MB). This is the reason the image
is glibc-based — DuckDB publishes no `delta` build for `linux_arm64_musl`.

Outside the image — a developer machine, or an image built without that step —
`LAKEHOUSE_DUCKDB_EXTENSION_DIR` is unset, DuckDB falls back to `~/.duckdb`, and
the service downloads any extension whose `LOAD` fails. Loading is always tried
first, so nothing hits the network once the binaries are present.

If your network is egress-restricted and you are not using the shipped image,
pre-populate an extension directory and point `LAKEHOUSE_DUCKDB_EXTENSION_DIR`
at it, or the app will boot healthy and fail on its first lakehouse read.

Lakehouse and external-datasource connections also need
`DATASOURCE_ENCRYPTION_KEY` set — see the warning in
[Datasources and lakehouse](#datasources-and-lakehouse) — and any custom
endpoint or Iceberg REST catalog must be listed verbatim in
`LAKEHOUSE_ALLOWED_ENDPOINTS`.

## Architecture

```
Browser ──── Frontend (static build) ──── Backend (NestJS, :3000)
   │                                            │
   │                                      ┌─────┴─────┐
   └──────── Yorkie server (:8080) ── PostgreSQL   Blob store (S3)
                    │                  (metadata)   (files/images)
                    └── auth webhook ──► Backend /internal/yorkie/auth
```

- **PostgreSQL** stores user accounts, document metadata, folders, share links,
  API keys, notifications and template listings.
- **Yorkie** handles real-time document synchronization between clients using
  CRDTs. Browsers talk to it **directly** (`VITE_YORKIE_RPC_ADDR`), not through
  the backend — which is why the auth webhook exists.
- **Backend** manages authentication, authorization, blob storage, datasources,
  and the REST API.
- **Blob store** holds uploaded files and embedded images.
- **Frontend** is a static bundle with its backend and Yorkie addresses compiled
  in.

## Data Ownership

All your data is stored in:

- **PostgreSQL** — user profiles, document records, folders, share links, API
  keys, notifications, template listings.
- **Yorkie** — editable document content (cells, text, slides, notes, board
  elements, comments) and its revision history.
- **Blob storage** — uploaded files, PDFs, image documents and embedded images
  (S3-compatible).

You control all of these services, and once the frontend is built with your own
values no telemetry leaves your infrastructure. Two notes on that:

- **Analytics is opt-in, and unset means off.** `VITE_GA_ID` is the one
  third-party hook — it injects gtag.js into the app (`vite.config.ts`) and into
  the docs site (`.vitepress/config.ts`) at build time. No committed file sets
  it any more, so doing nothing emits no gtag.js and makes no request to Google.
  You only get analytics by setting it to a property of your own. If you build
  from a checkout predating that change, or you copied an `.env.production`
  from one, check the value — it used to be wafflebase's measurement ID. See
  [Frontend build-time configuration](#frontend-build-time-configuration).
- The optional Share Link view-event pipeline records into the Kafka +
  StarRocks services you run yourself, and only when you enable it.

Back up your PostgreSQL database, your Yorkie data store, and your blob store to
preserve everything. Note that access control over the Yorkie data is only
enforced once you have completed **both** steps in
[Yorkie auth webhook](#yorkie-auth-webhook-per-document-access-control).

## Further Reading

- [`packages/backend/README.md`](https://github.com/wafflebase/wafflebase/blob/main/packages/backend/README.md)
  — the authoritative per-variable reference, kept next to the code.
- [`packages/frontend/README.md`](https://github.com/wafflebase/wafflebase/blob/main/packages/frontend/README.md)
  — frontend architecture.
- [`CONTRIBUTING.md`](https://github.com/wafflebase/wafflebase/blob/main/CONTRIBUTING.md)
  — development workflow and verification lanes.
