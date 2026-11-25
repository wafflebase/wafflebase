# Wafflebase Backend

NestJS API server for Wafflebase. Handles GitHub OAuth authentication, JWT session management, and document CRUD operations.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | NestJS 11, TypeScript |
| Database | PostgreSQL, Prisma 6.6 |
| Auth | Passport.js (GitHub OAuth2 + JWT) |
| HTTP | Express, cookie-parser |

## Getting Started

### Environment Variables

Create a `.env` file in this package:

```env
FRONTEND_URL=http://localhost:5173
DATABASE_URL=postgresql://wafflebase:wafflebase@localhost:5432/wafflebase
CHAT_LISTEN_DATABASE_URL=               # Optional. The connection chat's
                                        # LISTEN/NOTIFY listener uses; unset
                                        # falls back to DATABASE_URL. Point it
                                        # at Postgres directly when
                                        # DATABASE_URL goes through a
                                        # transaction-mode pooler (PgBouncer),
                                        # which silently drops LISTEN — a
                                        # probe on every connect logs a
                                        # warning when it does not round-trip.
JWT_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=your_refresh_secret   # Optional, defaults to JWT_SECRET
JWT_ACCESS_EXPIRES_IN=1h                # Optional
JWT_REFRESH_EXPIRES_IN=7d               # Optional
JWT_ACCESS_COOKIE_MAX_AGE_MS=3600000    # Optional
JWT_REFRESH_COOKIE_MAX_AGE_MS=604800000 # Optional
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_CALLBACK_URL=http://localhost:3000/auth/github/callback
GITHUB_AUTHORIZATION_URL=                # Optional. Unset → public github.com.
GITHUB_TOKEN_URL=                        # Set all four to a GitHub Enterprise
GITHUB_USER_PROFILE_URL=                 # instance to log in against it, e.g.
GITHUB_USER_EMAIL_URL=                   #   https://<host>/login/oauth/authorize
                                        #   https://<host>/login/oauth/access_token
                                        #   https://<host>/api/v3/user
                                        #   https://<host>/api/v3/user/emails
                                        # The email URL is separate: with the
                                        # user:email scope passport-github2
                                        # otherwise fetches emails from
                                        # api.github.com and a GHE token fails
                                        # there with "Bad credentials".
GOOGLE_CLIENT_ID=                        # Optional. Set all three to offer
GOOGLE_CLIENT_SECRET=                    # "Continue with Google" beside the
GOOGLE_CALLBACK_URL=                     # GitHub button, e.g.
                                        #   http://localhost:3000/auth/google/callback
                                        # Unlike GitHub's, the callback URL is
                                        # required: Google's authorization
                                        # endpoint has no fallback to the URL
                                        # registered on the OAuth client and
                                        # answers redirect_uri_mismatch without
                                        # one. With any of the three unset the
                                        # strategy is never registered,
                                        # /auth/google answers 404, and
                                        # GET /auth/providers reports
                                        # `google: false` so the login page
                                        # shows no Google button — a deployment
                                        # that wants GitHub only needs to
                                        # change nothing. A *partially*
                                        # configured install logs one warning
                                        # at boot naming what is missing.
COOKIE_SECURE=                          # Optional. Whether session and login
                                        # cookies carry `Secure` (and so the
                                        # `__Host-` prefix). Unset — the normal
                                        # case — derives it from
                                        # GITHUB_CALLBACK_URL's scheme, since
                                        # that is where GitHub redirects the
                                        # login and so is this server's public
                                        # scheme. GOOGLE_CALLBACK_URL is NOT
                                        # read here, in either direction: this
                                        # answer also decides whether
                                        # `wafflebase login` is offered and
                                        # whether the insecure-origin warning
                                        # fires, and it says nothing about the
                                        # origin GitHub reaches when
                                        # GITHUB_CALLBACK_URL is unset. An
                                        # https install that sets only the
                                        # Google URL says so with
                                        # COOKIE_SECURE=true. With
                                        # GITHUB_CALLBACK_URL unset it falls
                                        # back to
                                        # NODE_ENV=production. Set it to `true`
                                        # only when TLS terminates at an edge
                                        # and the callback URL is `http://`
                                        # anyway, which would otherwise
                                        # downgrade the session cookie.
                                        # `NODE_ENV=production` with a
                                        # non-loopback `http://` callback URL
                                        # logs a warning for that reason.
PORT=3000
LOG_LEVEL=info                          # Optional, Pino level
BACKEND_TRUST_PROXY=0                   # Optional, set to 1 behind a proxy
BACKEND_JSON_BODY_LIMIT=25mb            # Optional, body-parser limit
FILE_STORAGE_PREFIX=                    # Optional, object-key prefix for the
                                        # file bucket. Set it to namespace
                                        # wafflebase's objects inside a bucket
                                        # shared with another app; empty
                                        # (default) keeps keys at the root.
                                        # Surrounding "/" are trimmed. Fixed
                                        # for the deployment's lifetime —
                                        # changing it after uploads orphans
                                        # the objects already stored.
IMAGE_STORAGE_PREFIX=                   # Optional, the same for the image
                                        # bucket. Composes outside the
                                        # per-workspace key prefix.
DATASOURCE_ENCRYPTION_KEY=              # Required for datasource/lakehouse
                                        # credentials: 64 hex characters
WAFFLEBASE_SECRETS_ENCRYPTION_KEY=      # Optional, 64 hex characters. Encrypts
                                        # webhook signing secrets at rest.
                                        # Unset falls back to
                                        # DATASOURCE_ENCRYPTION_KEY; with
                                        # neither, creating a webhook answers
                                        # 503 and the boot log says why.
                                        # Changing the key in effect after
                                        # webhooks exist makes their secrets
                                        # unreadable: delete and re-create them.
WAFFLEBASE_WEBHOOKS_ENABLED=            # Optional. The literal `true` turns on
                                        # workspace webhooks (emission, the
                                        # delivery worker, the management
                                        # routes). Anything else is off: no
                                        # event rows, no outbound requests,
                                        # and every webhook route but the list
                                        # answers 404.
WAFFLEBASE_WEBHOOK_ALLOWED_CIDRS=       # Optional, comma-separated exact CIDRs
                                        # (`10.0.4.0/24,fd00::/8`) the SSRF
                                        # guard lets through although they are
                                        # private — an n8n on the same network.
                                        # An entry that does not parse is
                                        # dropped, never widened.
WAFFLEBASE_WEBHOOK_ALLOW_HTTP=          # Optional. The literal `true` permits
                                        # `http://` endpoints; anything else
                                        # keeps https only.
WAFFLEBASE_WEBHOOK_QUIET_MS=60000       # Optional. `document.content_updated`
                                        # is sent once a document has been
                                        # quiet this long…
WAFFLEBASE_WEBHOOK_MAX_WAIT_MS=300000   # …or at most this long after the
                                        # first edit of the window.
LAKEHOUSE_ALLOWED_ENDPOINTS=            # Optional comma-separated exact HTTP(S)
                                        # origins for custom S3/Azure/GCS-interop
                                        # endpoints and Iceberg REST catalogs
LAKEHOUSE_QUERY_TIMEOUT_MS=30000         # Optional, 100..300000
LAKEHOUSE_DUCKDB_MEMORY_LIMIT=512MB      # Optional, integer KB/MB/GB
LAKEHOUSE_DUCKDB_THREADS=2               # Optional, 1..32
LAKEHOUSE_DUCKDB_POOL_SIZE=2             # Optional, 1..8; operations remain
                                        # globally serialized for secret safety
LAKEHOUSE_DUCKDB_MAX_PENDING=64          # Optional, 1..1000
LAKEHOUSE_ALLOW_LOCAL_PATHS=false        # Optional, trusted-admin feature
LAKEHOUSE_LOCAL_ROOT=                    # Required when local paths are enabled
YORKIE_RPC_ADDR=http://localhost:8080   # Optional, Yorkie RPC/admin endpoint
YORKIE_PUBLIC_KEY=                      # Optional, project public key (SDK)
YORKIE_SECRET_KEY=                      # Optional, project secret key; enables
                                        # "currently editing" presence on
                                        # the documents list. Omit and the
                                        # list still works without avatars.
                                        # Also the HMAC key for the Yorkie
                                        # event + auth webhook signature guard.
YORKIE_TOKEN_EXPIRES_IN=10m             # Optional, lifetime of the short-lived
                                        # Yorkie auth-webhook token minted by
                                        # GET /auth/yorkie-token.
YORKIE_AUTH_WEBHOOK_ENFORCE=            # Optional. Unset (the default) =
                                        # enforce per-document access at the
                                        # Yorkie auth webhook. The word
                                        # `false` — trimmed and matched
                                        # case-insensitively, so `FALSE`
                                        # counts — and nothing else selects
                                        # shadow mode: log the access decision
                                        # but never deny. A typo in any other
                                        # direction therefore enforces rather
                                        # than opening the door.
WAFFLEBASE_API_ORIGIN=                  # Optional, this deployment's own public
                                        # API origin (scheme + host + port).
                                        # Used to decide whether an absolute
                                        # image URL stored inside a document is
                                        # first-party before re-hosting it
                                        # across a workspace boundary — the
                                        # string comes out of the CRDT, where
                                        # any collaborator can write
                                        # https://attacker.example/api/v1/...
                                        # Unset falls back to the origin of
                                        # GITHUB_CALLBACK_URL; with neither
                                        # set, only root-relative references
                                        # are re-hosted, which is the safe
                                        # direction but silently does nothing
                                        # on a deployment whose frontend was
                                        # built with VITE_BACKEND_API_URL.
WAFFLEBASE_TEMPLATE_REVIEWER_IDS=       # Optional, comma-separated user ids
                                        # allowed to decide public template
                                        # submissions. Unset or empty means
                                        # nobody, which keeps the public
                                        # template gallery shut — the same
                                        # direction every other gate in that
                                        # feature fails in. Anything that is
                                        # not a positive integer is dropped,
                                        # so a typo cannot grant review
                                        # authority to user 0.
WAFFLEBASE_KAFKA_ADDRESSES=             # Optional, comma-separated Kafka
                                        # broker addresses for the view-event
                                        # analytics producer. Unset disables
                                        # analytics ingestion.
WAFFLEBASE_KAFKA_TOPIC=                 # Optional, Kafka topic for view
                                        # events. Unset disables analytics
                                        # ingestion.
SENTRY_DSN=                             # Optional. Unset — the default —
                                        # means `Sentry.init` is never called
                                        # (`src/instrument.ts`): no handlers
                                        # installed, no network egress, no
                                        # behavior change. Set it to your own
                                        # project's DSN to report unhandled
                                        # exceptions and request traces.
                                        # Nothing here is specific to
                                        # wafflebase's own Sentry org, and no
                                        # DSN is baked in as a default — a
                                        # self-host must not report its users'
                                        # errors to somebody else.
SENTRY_ENVIRONMENT=                     # Optional, the `environment` tag on
                                        # every event. Defaults to NODE_ENV.
                                        # An EMPTY value counts as unset: that
                                        # is how "unset" actually arrives from
                                        # a k8s `value: ""` or a bare `=` line.
SENTRY_RELEASE=                         # Optional, the `release` tag. Defaults
                                        # to this package's own version, which
                                        # is kept in lockstep with the root
                                        # package.json the frontend bakes in —
                                        # so with both unset the two halves
                                        # still report the SAME release and one
                                        # deploy's events line up. Override
                                        # only if your build stamps something
                                        # else. Empty counts as unset.
SENTRY_TRACES_SAMPLE_RATE=0.1           # Optional, 0..1. Anything outside that
                                        # range, or unparseable, falls back to
                                        # 0.1 rather than to 1.0 — a typo must
                                        # not become "sample everything".
                                        # Only read when SENTRY_DSN is set.
WAFFLEBASE_STARROCKS_DSN=               # Optional, StarRocks DSN
                                        # (`user:pass@tcp(host:port)/db`) for
                                        # the analytics warehouse query path.
                                        # Unset disables the document
                                        # analytics dashboard (returns
                                        # `enabled: false`).
WAFFLEBASE_DEMO_RESET_TARGETS=          # Optional, comma-separated
                                        # `<shareToken>:<revisionId>` pairs
                                        # for the homepage demo documents
                                        # (tokens = the frontend's
                                        # VITE_DEMO_*_SHARED_TOKEN values).
                                        # Editor tokens are write
                                        # credentials: set this from a
                                        # secret, not a committed manifest.
                                        # Once a day each is restored to that
                                        # revision so visitor edits do not
                                        # pile up. Unset arms no timer.
                                        # Pinned by id, never by label:
                                        # CreateRevision is not gated by the
                                        # auth webhook, so any editor-link
                                        # visitor can name a revision
                                        # anything. A token with no
                                        # `:<revisionId>` is not reset; at
                                        # boot its newest revisions labelled
                                        # WAFFLEBASE_DEMO_RESET_LABEL are
                                        # logged with their ids, to pin one.
WAFFLEBASE_DEMO_RESET_LABEL=demo-golden # Optional, the label that boot-time
                                        # candidate listing filters on. Name
                                        # it with the history panel's "Name
                                        # current version".
WAFFLEBASE_DEMO_RESET_HOUR_UTC=15       # Optional, 0..23. 15 = 00:00 KST.
                                        # Anything else falls back to 15.
```

`GITHUB_CALLBACK_URL`'s scheme is read as the deployment's public scheme: it
decides whether the login cookies are `Secure` (and so `__Host-`-prefixed), and
with it whether `wafflebase login` is available at all. CLI sign-in answers
`400 Command-line sign-in requires an https server` unless it can see that its
consent cookie is trustworthy — an `https://` callback URL (or
`COOKIE_SECURE=true`), or a loopback one. A plain-http non-loopback callback
URL is the case it refuses, because anything on such an origin can plant that
cookie. Serve over https (or keep it on `localhost`) to use it.

Configuring **no** callback URL at all is not that case. `isSecureCookie()`
(`src/auth/oauth-state.ts`) resolves the scheme in three steps —
`COOKIE_SECURE`, then the callback URL's scheme, then, with neither set,
`NODE_ENV === 'production'` — so an install with no callback URL and no
`COOKIE_SECURE` reads as https, mints its cookies `Secure`/`__Host-`, and
`cliLoginAvailable()` (`src/auth/github-auth.guard.ts`) *allows* CLI sign-in.
That is the shipped image's default, since the `Dockerfile` sets
`NODE_ENV=production`; outside production the same install refuses. Both cases
are asserted in `src/auth/github-auth.guard.spec.ts`. Allowing it is deliberate
rather than an oversight: if the origin turns out to be cleartext the browser
discards a `Secure` `__Host-` cookie on arrival, so the consent gate fails
closed — the login cannot complete — rather than open. The operational
consequence is that whether `wafflebase login` is offered tells you nothing
about your deployment's real scheme; set `GITHUB_CALLBACK_URL` to the https URL
your users actually reach and the question does not arise.

### Lakehouse: DuckDB extensions are bundled into the image

The lakehouse connector needs four DuckDB extensions (`httpfs`, `iceberg`,
`delta`, `azure`, plus `avro` which `iceberg` pulls in). The production image
downloads them **at build time** into `LAKEHOUSE_DUCKDB_EXTENSION_DIR`
(`/app/.duckdb-extensions`) for the platform it will run on, so a deployment
needs no egress to `extensions.duckdb.org`:

- `verify-backend-image` in CI builds the image for amd64 and arm64 and runs
  `packages/backend/test/smoke-duckdb-runtime.cjs` inside it with
  `--network none`. That is the real assertion — an image that lost the
  bundling step fails there rather than on a deployment's first read.
- The build step also `LOAD`s each extension, so a platform whose binary is
  missing (the reason the image is glibc-based: DuckDB publishes no `delta`
  build for `linux_arm64_musl`) fails the build instead of production.
- Cost: roughly 170 MB of extension binaries, most of it `delta` (73 MB) and
  `iceberg` (44 MB).

Outside the image — a developer machine, or an image built without that step —
`LAKEHOUSE_DUCKDB_EXTENSION_DIR` is unset, DuckDB falls back to `~/.duckdb`,
and the service downloads any extension whose `LOAD` fails. Loading is always
tried first, so nothing hits the network when the binaries are already there.

### Yorkie auth webhook (per-document access control)

`POST /internal/yorkie/auth` enforces per-document read/write access at the
Yorkie layer (design: [`docs/design/yorkie-auth-webhook.md`](../../docs/design/yorkie-auth-webhook.md)).
It is HMAC-verified with `YORKIE_SECRET_KEY` (same guard as the event webhook)
and reads the caller's identity from a backend-minted token supplied by the
frontend via `authTokenInjector`. Register it on the Yorkie project (auth
webhook is a per-project setting, not a server flag):

```bash
yorkie login --rpc-addr localhost:8080          # once, as the project admin
yorkie project update <project> \
  --auth-webhook-url http://host.docker.internal:3000/internal/yorkie/auth \
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

`AttachDocument` is safe to register but is authorized as a **read**: Yorkie
sends it with verb `rw` unconditionally — even for a fresh local document with
no local changes — so honoring that verb would refuse a share-link viewer their
very first attach and break every viewer link on the deployment.
`READ_GATED_METHODS` in `yorkie-auth.controller.ts` therefore ignores attach's
verb, and `PushPull`, whose verb does reflect the change pack, stays the write
gate. The residual is a write smuggled inside the attach's own change pack by a
hand-rolled client; see
[`docs/design/yorkie-auth-webhook.md`](../../docs/design/yorkie-auth-webhook.md)
§ Risks.

**Do not add `CreateRevision`.** Yorkie calls the webhook for it with
`attributes: null` — no document key, no verb — for every caller, and
`decide()` fails closed on a document-scoped method with no attributes. So
registering it denies `CreateRevision` to *everyone*, the document's owner
included, and "Name current version" stops working. Leaving it unregistered
leaves it ungated: any attached client can create a revision. That is a
nuisance rather than a destructive hole, and closing it needs an upstream fix
(see [`docs/design/revision-history.md`](../../docs/design/revision-history.md) §6).
The other three revision methods do receive real attributes and are authorized
correctly. `test/revision-history.e2e-spec.ts` exercises that against a real
server, but its `refuses a read-only client` case is currently `it.skip` —
it provisions a scratch Yorkie project through the `yorkie` **admin CLI**,
which CI does not install (only the `yorkieteam/yorkie` server container is
available there), so unskipping it would error out rather than fail an
assertion. It has been run by hand; see the comment above the test. What CI
guards today is the *decision logic*, in
`src/document/yorkie-auth.controller.spec.ts` — not the end-to-end denial
against a live Yorkie server. Re-run the skipped case locally with the admin
CLI on `PATH` before trusting the registration on a deployment.

`ListRevisions` and `GetRevision` are a deliberate exception to the plain
verb check. Yorkie sends them with verb `r`, which a share-link **viewer**
passes; but `getRevision` returns a full snapshot of every past state,
including content deleted before the link was shared. So
`REVISION_READ_METHODS` in `yorkie-auth.controller.ts` requires the same
editor-or-member authority a write does for those two. Workspace members and
share-link *editors* keep their history; only viewers lose it, matching Google
Docs and the panel's own client-side gating. An ordinary `r` (`PushPull`,
`Watch`) is untouched — a viewer can still read the document itself.

Registering the methods is the whole switch: with `YORKIE_AUTH_WEBHOOK_ENFORCE`
unset the backend enforces the decision it computes. If you want to watch first,
opt into shadow mode with `YORKIE_AUTH_WEBHOOK_ENFORCE=false` (logs the decision
it *would* make), confirm no false denials, then **unset it again**. Unregister
the methods (`--auth-webhook-method-rm ALL`) to disable. Shadow mode allows
every request regardless of the computed decision, so a deployment left in it is
not protected — an anonymous viewer share link can still list, read, and restore
a document's revision history.

The same holds for ordinary **writes**, and it is the more important half: this
webhook is the only place a share-link `viewer` is refused one, and a viewer
holds what it takes to skip us — their share token mints a Yorkie token at
`GET /auth/yorkie-token`, and the project's public key ships in every visitor's
bundle, so a bare SDK client attaches and writes. The read-only mounts the
editors use on share routes bound *this app's* write paths, not anybody else's;
treat a viewer link on a shadow-mode deployment as write-capable. The
controller says which posture it is in at boot — `yorkie auth webhook:
enforcing per-document access`, or a `SHADOW mode … per-document access is NOT
enforced` warning — so check the log rather than the absence of denials.

### Development

```bash
# From the monorepo root:
pnpm install
docker compose up -d              # Start PostgreSQL + Yorkie

# Run database migrations:
pnpm backend migrate

# Start dev server:
pnpm dev                          # Starts frontend (:5173) + backend (:3000)

# Or run the backend only:
pnpm backend start:dev
```

### Build

```bash
pnpm backend build
```

### Testing

```bash
pnpm backend test                 # Unit tests (Jest)
pnpm backend test:e2e             # E2E + DB-backed integration tests
pnpm verify:integration           # Root integration lane (forced DB-backed)
pnpm verify:integration:docker    # One-command local postgres + integration
```

`test:e2e` includes database-backed tests for datasource/share-link services.
Set `RUN_DB_INTEGRATION_TESTS=true` and provide a reachable `DATABASE_URL`
before running it.

It covers both DB-backed service integration and authenticated HTTP integration
through JWT guards/controllers for core datasource/share-link/document flows.

`RUN_LAKEHOUSE_INTEGRATION_TESTS=true` enables the lakehouse connector-parity
suite (`test/lakehouse-parity.e2e-spec.ts`): real DuckDB against MinIO S3,
GCS-interop (HMAC through MinIO), Azurite Azure (set
`LAKEHOUSE_AZURITE_ENDPOINT`, e.g. `http://127.0.0.1:10000/devstoreaccount1`),
and the local filesystem. `docker compose up -d minio azurite` provides both
emulators; see `test/fixtures/lakehouse/README.md` for the fixture contract
and the opt-in real-cloud smoke.

A separate gate `RUN_YORKIE_INTEGRATION_TESTS=true` enables tests that
attach to a running Yorkie server (e.g.,
`packages/backend/test/docs-tree-attached.e2e-spec.ts` and
`packages/backend/test/docs-cli-roundtrip.e2e-spec.ts`). These require
both Postgres **and** Yorkie running. Local opt-in:

```bash
docker compose up -d   # PostgreSQL + Yorkie
RUN_DB_INTEGRATION_TESTS=true \
  RUN_YORKIE_INTEGRATION_TESTS=true \
  pnpm --filter @wafflebase/backend test:e2e
```

CI parity: the `verify-integration` job in `.github/workflows/ci.yml`
runs Postgres as a service and launches the `yorkieteam/yorkie`
container as a background step, with both gates set, so the
Yorkie-attached suites run on every PR.

If the database schema is not up-to-date, apply migrations first:

```bash
pnpm --filter @wafflebase/backend exec prisma migrate deploy
```

## API Endpoints

### Authentication (`/auth`)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/auth/github` | - | Initiate GitHub OAuth flow (mints the OAuth `state`; `?mode=cli` is gated on a confirmation click) |
| `GET` | `/auth/github/callback` | - | OAuth callback; requires a matching `state`, sets access/refresh cookies, redirects to frontend |
| `GET` | `/auth/google` | - | Initiate Google OAuth flow (browser only — no `?mode=cli`). `404` unless `GOOGLE_*` is configured |
| `GET` | `/auth/google/callback` | - | OAuth callback; same browser `state` check as GitHub's, then session cookies |
| `GET` | `/auth/providers` | - | `{ github, google }` — which sign-in buttons the login page should offer |
| `GET` | `/auth/me` | JWT | Get current authenticated user |
| `POST` | `/auth/refresh` | Refresh cookie | Rotate access/refresh cookies |
| `POST` | `/auth/logout` | - | Clear session cookies |

### Documents (`/documents`)

All document endpoints require JWT authentication.

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/documents` | List documents across the user's workspaces (each row carries `canManage`) |
| `GET` | `/documents/:id` | Get document by ID (workspace member) |
| `POST` | `/documents` | Create a new document (`{ title }`) |
| `PATCH` | `/documents/:id` | Rename (any member) or move (`{ workspaceId }`, manager only) |
| `POST` | `/documents/:id/copy` | Duplicate a document into the same workspace + folder as `<title> (copy)` (any member — copying never touches the source) |
| `DELETE` | `/documents/:id` | Move to the trash (manager: workspace owner or author); `?permanent=true` deletes a trashed document for good, blob included (`404` while it is live) |
| `POST` | `/documents/delete` | Bulk trash (`{ ids }`), or bulk permanent delete of trashed ids (`{ ids, permanent: true }`); manager of every id |
| `POST` | `/documents/:id/restore` | Restore a trashed document (manager); `404` if it is not in the trash |
| `GET` | `/workspaces/:wid/trash` | Trashed documents of a workspace, most recent first (member); rows carry `canManage` + `deletedAt` |

**Trash.** Deleting a document moves it to the trash (`Document.deletedAt`)
rather than destroying it, and a trashed document is invisible everywhere a live
one is visible — every list, `GET /documents/:id`, share-link resolution, the
Yorkie auth webhook (denied), templates, copy, file serving and all of
`/api/v1` answer as if it did not exist (`404`). Share links and template
listings survive and come back on restore; the blob is kept until the
permanent delete. There is **no automatic purge** yet. Design:
[`docs/design/document-trash.md`](../../docs/design/document-trash.md).

### Folders (`/workspaces/:workspaceId/folders`)

All folder endpoints require JWT authentication. Folders are workspace-scoped and
purely organizational — they do not affect document access.

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/workspaces/:wid/folders` | JWT (member) | Create a folder (`{ name, parentId? }`) |
| `GET` | `/workspaces/:wid/folders` | JWT (member) | List all folders in the workspace (flat; `parentId` builds the tree) |
| `PATCH` | `/folders/:id` | JWT | Rename (`{ name }`, any member) or move (`{ parentId }`, manager only; cycle-checked) |
| `DELETE` | `/folders/:id` | JWT (manager) | Delete folder; descendant folders are removed and their documents return to the workspace root (never deleted) |

Documents gain folder support: `GET /workspaces/:wid/documents?folderId=` filters
to a folder (omitted = workspace root); document create and `PATCH /documents/:id`
accept `folderId` (`null` = move to root, manager-gated like the workspace move).

### Templates (`/templates`)

Publishing a document as a template and starting a new document from one
(design: [`docs/design/template-gallery.md`](../../docs/design/template-gallery.md)).

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/documents/:id/template` | JWT (manager) | Publish or re-publish as a template |
| `GET` | `/documents/:id/template` | JWT | The document's listing, or `null` |
| `PATCH` | `/templates/:id` | JWT (manager) | Edit listing metadata |
| `DELETE` | `/templates/:id` | JWT (manager) | Unpublish; revokes the preview link |
| `GET` | `/templates/:id` | Optional JWT | Listing metadata + preview token |
| `POST` | `/templates/:id/use` | JWT (member of the destination) | Start a new document from the template |
| `POST` | `/templates/:id/submit` | JWT (manager) | Ask for the public tier (`{ acceptLicense: true }`) |
| `POST` | `/templates/:id/review` | JWT + reviewer allowlist | `approve` / `reject` / `takedown` |
| `GET` | `/admin/templates/review` | JWT + reviewer allowlist | Pending submissions, with preview tokens |
| `POST` | `/templates/:id/report` | JWT (throttled per user) | Flag a listing for a reviewer |
| `GET` | `/admin/templates/reports` | JWT + reviewer allowlist | Open reports |
| `POST` | `/admin/templates/reports/:reportId` | JWT + reviewer allowlist | Close a report (`dismissed` / `actioned`) |

A template is **not** a `Document.type` — that column routes which editor opens
a document, so the listing is a sidecar row and publishing is an upsert on its
unique `documentId`. Publishing is gated at the `isDocumentManager` tier at
every visibility tier, the same bar as minting an editor share link and for the
same reason: it hands the content to an audience workspace membership no longer
bounds. It mints a non-expiring `viewer` `ShareLink`, which is what lets an
anonymous visitor preview the template through the existing `/shared/:token`
machinery; revoking that link from the Share dialog degrades the listing to a
card without a live preview rather than breaking it.

`POST /templates/:id/use` is the one route where a document crosses a workspace
boundary, so authorization inverts: **read** authority comes from the listing's
visibility (`public` and listed, `workspace` and the caller is a member, or
`unlisted` and the caller holds the id), **write** authority from
`assertMember` on the *destination*. It runs `DocumentCopyService` with a
destination, so every document type is covered by the same engine "Make a copy"
uses; the new document is authored by whoever used the template and is named
after it (`uniqueTitle`, not `copyTitle` — a document started from a "Weekly
Report" template is a weekly report, not a copy of one).

A tier the caller may not see answers `404`, not `403`: whether a workspace has
published a template is itself workspace information.

#### Review (the public tier)

`visibility: 'public'` has exactly **one** writer: the approve arm of
`POST /templates/:id/review`. Publish and update refuse a *transition into* it
permanently — not "until Phase 3", but as the design — so a publisher asks
through `POST /templates/:id/submit`, which moves `status` to `pending` and
leaves `visibility` alone. That separation is what makes submitting observable
to nobody: an unlisted link already handed out keeps resolving, and a workspace
listing does not silently widen while a reviewer looks at it.

`status` is therefore a review state, not an audience: `listed` / `pending` /
`rejected` / `removed`. A **rejection** says the submission missed the
gallery's bar and leaves the listing working at the tier it already had; a
**takedown** (`removed`) says the content may not be served at all, so it
refuses every non-manager read and revokes the preview share link. `removed` is
terminal: it refuses resubmission, republishing, editing **and unpublishing** —
the last because deleting the row would make the next publish a `create`, which
mints a fresh anonymous preview link to the content that was removed, so
unpublish → publish would otherwise reverse a takedown. Reading stays open to
the listing's manager, who has to be able to see the decision: a listing carries
`submittedAt` / `reviewedAt` / `reviewNote` back to its manager (and to the
reviewer queue) and to nobody else.

Both review routes are gated by `TemplateReviewerGuard`, stacked after
`JwtAuthGuard`, reading a comma-separated allowlist from
`WAFFLEBASE_TEMPLATE_REVIEWER_IDS`. **An unset or empty value means nobody**, so
a deployment that configures nothing has no review pipeline and the gallery
stays shut. `GET /admin/templates/review` is the one collection here that
returns `previewToken`s: a reviewer belongs to neither the publisher's
workspace nor the document, so nothing else would let them see what they are
deciding.

**The tier is open**, with two runtime preconditions checked at both `submit`
and `approve` — a setting can change between a submission and its decision:

- `WAFFLEBASE_TEMPLATE_REVIEWER_IDS` must name somebody. No reviewers means no
  review pipeline.
- `YORKIE_AUTH_WEBHOOK_ENFORCE` must be the literal `true`. Unless the webhook
  actually refuses them, the preview token a public card hands every visitor
  also grants *write* access to the document, and since an edit returns a
  listing to review, one request per card would empty the gallery into a queue
  only a human can drain. This is deliberately stricter than the webhook's own
  reading of the same variable (where unset means enforce), because the gate is
  asking a different question: whether per-document access is *actually* being
  enforced here, which also needs the auth-webhook methods to have been
  registered on the Yorkie project — a manual step no environment variable can
  attest. So the operator affirms it, and a typo shuts the gallery instead of
  opening it.

`PUBLIC_TIER_OPEN` (`src/template/template-review.ts`) stays as a constant
rather than being deleted: it is the one line to flip if the gallery has to be
shut for a moderation incident or a migration, without reverting a feature or
teaching every deployment a new setting.

#### Seeding the gallery

Two operator commands fill a deployment's public gallery from the catalogue in
`src/template/seed/catalog/` (everything there is authored for this repo and
Apache-2.0 licensed; see that directory's `README.md` before adding to it).

```bash
pnpm backend seed:templates:build --workspace <workspaceId> --author <userId>
pnpm backend register:templates:build --author <userId> [--frontend URL] [--reset]
```

They run from `dist`, not through `tsx`: esbuild emits no
`design:paramtypes`, so a Nest context booted under `tsx` resolves every
injected dependency to `undefined`. The `:build` variants compile first.

**`seed:templates` only creates the documents** and writes their content
through the same writers the v1 content endpoints use. It deliberately does
*not* publish them. Registering happens through the product's own Share dialog,
driven by `register:templates` with Playwright, because a template's thumbnail
is captured by whichever editor is mounted at publish time — a headless publish
has no editor and therefore no picture. That ordering is also the only one the
review rules allow: `thumbnailId` is a `CARD_FIELD`, so attaching it after
approval returns the listing to review, and attaching it while `pending` is
refused outright.

`register:templates` mints the same session cookie the OAuth callback writes,
publishes each document, sets its category and tags, submits it, then approves
the queue at `/admin/templates`. It needs Chromium
(`pnpm --filter @wafflebase/frontend exec playwright install chromium`) and a
running frontend and API. It is **not** idempotent — a document that already
has a listing is skipped, since the dialog shows the listing form rather than
the publish block once one exists; `--reset` unpublishes first.

**`register:templates` requires the webhook to be enforcing** — the same
`YORKIE_AUTH_WEBHOOK_ENFORCE=true` the server demands, because a public
listing's preview token would otherwise also grant write access. `seed:templates`
needs no such ordering: it writes content through `YorkieService`, which
authenticates to the webhook as this backend
(`src/yorkie/yorkie-service-token.ts`), so its writes survive enforcement. The
same token is what keeps the v1 content endpoints and `DocumentCopyService`
working with the webhook methods registered.

Both commands also require `WAFFLEBASE_TEMPLATE_REVIEWER_IDS` to name the
`--author`, who approves their own submissions — which is what a seed is, and
why the command mints no authority of its own.

#### Reports

`POST /templates/:id/report` records that somebody objected and does nothing
else — it does not hide the listing, notify the publisher, or count toward a
threshold. A report that acted on its own would be a takedown anyone could
trigger. One row per reporter per listing (a unique index), authorized on "can
you see this listing", and throttled on the caller rather than their address.
Reporting is **public-tier only** — a report routes the listing to the global
reviewer allowlist with its preview token, and a workspace or unlisted listing
has its own trust boundary. Re-filing updates your reason but does not reopen a
closed report, so a dismissal cannot be forced back into the queue.

Closing a report is a **separate action from deciding the listing**: most
reports do not end in a takedown, and a queue that only empties when content is
removed pressures whoever drains it toward removing content. A takedown does
close every open report about the listing, inside the same transaction — a
reviewer who closes the tab mid-session must not leave reports that can never be
closed, since a second takedown on a `removed` listing is a `400`.

Submissions and re-reviews notify the allowlist (`template_review_queued`,
deduped per listing per day). Without that the queue is a page somebody has to
remember to open, while re-reviews arrive whenever anyone edits an approved
template's document.

### Miro import (`/workspaces/:workspaceId/miro/import`)

Reads a Miro board on the caller's behalf so it can be imported as a
`"board"` document (design: [`docs/design/board/board-miro-import.md`](../../docs/design/board/board-miro-import.md)).

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/workspaces/:wid/miro/import` | JWT (member) | Fetch a Miro board's items + connectors (`{ token, boardUrl }`) and return `{ items, connectors, notes }` |

The caller supplies their own Miro access token in the request body. It is used
for that request only — **never stored, never logged, and never returned**;
there is no Miro credential in the database and no Prisma model for it. Items
and connectors come from two separate paginated Miro endpoints (`/items` does
not include connectors). Image bytes are downloaded with the token (Miro's
`imageUrl` is auth-scoped and expires in ~60s) and re-uploaded into the
workspace image bucket, so the stored document references a stable wafflebase
URL. Anything skipped — unsupported item types, failed images, a truncated or
stalled read — is reported back in `notes` and surfaced to the user rather than
dropped silently.

### Analytics

`POST /internal/analytics/view-events` is a beacon endpoint (share-token
attributed, no JWT required) that batches client view events onto Kafka;
disabled (no-op) when `WAFFLEBASE_KAFKA_ADDRESSES`/`WAFFLEBASE_KAFKA_TOPIC`
are unset. `GET /documents/:id/analytics` requires JWT auth and is
manager-gated (workspace owner or document author); it queries the
StarRocks warehouse and returns `enabled: false` with empty metrics when
`WAFFLEBASE_STARROCKS_DSN` is unset.

`GET /workspaces/:workspaceId/analytics` is workspace-member-gated and
aggregates views across the workspace's documents (totals + per-document
ranking), reusing the same StarRocks warehouse.

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/internal/analytics/view-events` | Optional JWT (share token) | Ingest a batch of client view events (`{ shareToken, events }`) |
| `GET` | `/documents/:id/analytics` | JWT (manager) | Get document view analytics (`?from=&to=`, defaults to last 30 days) |
| `GET` | `/workspaces/:wid/analytics` | JWT (member) | Workspace-aggregate analytics: totals + per-document ranking (`?from=&to=`) |

#### Local smoke test

The analytics pipeline runs off Kafka + StarRocks, provided as an **opt-in**
Docker Compose profile (kept out of the default stack):

```bash
docker compose --profile analytics up -d   # + the default postgres/yorkie/minio
```

Then point the backend at it in `packages/backend/.env`:

```env
WAFFLEBASE_KAFKA_ADDRESSES=localhost:29092
WAFFLEBASE_KAFKA_TOPIC=wafflebase-view-events
WAFFLEBASE_STARROCKS_DSN=root:@tcp(localhost:9030)/wafflebase
```

Open a document via a share link to emit events, then visit the workspace
**Analytics** tab (`/w/:workspaceId/analytics`). With the env vars unset the
whole pipeline is a no-op and the dashboard shows "not enabled" — the app is
unaffected.

### Notifications (`/notifications`)

In-app notifications for the header bell (design:
[`docs/design/notifications.md`](../../docs/design/notifications.md)). All
routes require JWT authentication and are scoped to the caller — one user can
never read or mark another user's notifications.

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/notifications/comment` | Client report of a comment event (mention / reply / resolve) |
| `GET` | `/notifications` | 20 most recent for the caller (`?before=<ISO 8601>&beforeId=<id>` composite cursor, strictly ISO-validated; `beforeId` without `before` is a 400) |
| `GET` | `/notifications/unread-count` | `{ count }` |
| `POST` | `/notifications/read` | `{ ids? }` — omitted marks everything read |
| `GET` | `/notifications/stream` | SSE badge stream |

Comments live inside Yorkie CRDT documents and never pass through this
backend, so the **client reports** comment events and the server authorizes
them: the actor must belong to the document's workspace, and so must every
recipient (non-members are dropped, not rejected). The actor never notifies
themselves, previews are truncated to 200 characters with control and
invisible formatting characters stripped, one report fans out to at most 20
recipients, and the endpoint is throttled to 30 reports per minute **per
authenticated user** (`UserThrottlerGuard`, which keys the bucket on the
caller rather than their IP; the global per-IP bucket still applies on top). A
repeated report is absorbed by a unique index rather than creating a second
row.

That still permits a sustained 30 × 20 rows per minute into peers' inboxes,
and nothing is deleted — a workspace peer can make another member's inbox
noisy. Bounding that needs a per-recipient ceiling or the retention job, both
deferred; see `docs/design/notifications.md`.

`workspace_member_joined` is the exception: it is created server-side in
`WorkspaceService.acceptInvite()`, where the backend already has authority,
and goes to the workspace owners plus the invite's creator.

`/notifications/stream` carries `{ unreadCount, latestId }` only — the client
refreshes its badge from the stream and fetches the list when the dropdown
opens. Delivery is an in-process hub (instant for notifications created on the
same replica) merged with a 60-second database re-check, which is what makes
the stream correct across multiple replicas without Redis or Kafka. No
environment variable configures any of this.

### Chat (`/workspaces/:workspaceId/chat`)

Workspace chat: public and private channels, DMs of 2–8 people, threads,
edit and soft delete, and a per-member read position that drives unread
counts (design: [`docs/design/chat.md`](../../docs/design/chat.md)). All
routes require JWT authentication; `:workspaceId` accepts the workspace id
or its slug. A channel the caller cannot read — another workspace's, a private
one they are not in, any channel once they leave the workspace — answers
`404`, the same as an unknown id.

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/workspaces/:wid/chat/channels` | Channels the caller can see, with `unreadCount` / `mentionCount` |
| `POST` | `/workspaces/:wid/chat/channels` | Create a public/private channel (`{ kind, name, topic? }`), or find-or-create a DM (`{ kind: 'dm', userIds }`) |
| `PATCH` | `/workspaces/:wid/chat/channels/:cid` | Rename, topic, archive/unarchive — channel creator or workspace owner; never a DM |
| `GET` | `/workspaces/:wid/chat/channels/:cid/members` | Who is in a public or private channel, each row with the caller's `canRemove` |
| `POST` | `/workspaces/:wid/chat/channels/:cid/members` | No `userIds`: join a public channel. With `userIds`: invite |
| `DELETE` | `/workspaces/:wid/chat/channels/:cid/members/me` | Leave (not a DM, not the default channel) |
| `DELETE` | `/workspaces/:wid/chat/channels/:cid/members/:userId` | Remove someone else — the channel's creator or a workspace owner (an owner only by an owner); not a DM or the default channel |
| `GET` | `/workspaces/:wid/chat/channels/:cid/messages` | 50 per page, ascending `seq`: `?before=` / `?after=<seq>`, `?thread=<rootId>` |
| `POST` | `/workspaces/:wid/chat/channels/:cid/messages` | `{ body, threadRootId?, alsoInChannel?, clientId? }`; 30 per 10 s per user. A repeated `clientId` returns the first message; a reply to a deleted root is `409` |
| `GET` | `/workspaces/:wid/chat/channels/:cid/files` | Documents linked in the channel, newest share first, one row per document (`?limit=` 1–100, `?before=<cursor>`) |
| `POST` | `/workspaces/:wid/chat/channels/:cid/read` | `{ seq }` — never moves backwards, capped at the channel's last `seq` |
| `GET` | `/workspaces/:wid/chat/messages/:mid` | One message (a bell deep link learns whether it is a thread reply) |
| `PATCH` | `/workspaces/:wid/chat/messages/:mid` | Edit one's own message (`{ body }`) |
| `DELETE` | `/workspaces/:wid/chat/messages/:mid` | Soft-delete one's own message: the row and its `seq` stay, the body is cleared |
| `GET` | `/chat/stream` | Per-user SSE across every workspace: `ready`, `message`, `update`, `ping` |

A post allocates the channel's next `seq` under its row lock inside the
insert transaction, so a channel's order is total and gap-free, and
`?after=<seq>` is the catch-up cursor. An archived channel is read-only:
posting, editing and deleting answer `409`. Mention tokens
(`@[username](userId)`) are rewritten to the target's real username on post
and edit, and a token naming somebody outside the workspace is flattened to
plain `@name`. Mentions and thread replies reach the bell through the
`Notification` table (`chat_mention`, `chat_thread_reply`), each recipient
checked against their own access to the channel.

A message body's links to this deployment's documents become
`ChatDocumentRef` rows, each stored only for a live document in the
channel's own workspace, and come back on the message as `refs` (title and
type read at read time). An edit replaces them and a delete clears them.

The stream carries ids only. `ready` opens every (re)connect and is the
client's cue to re-read unread counts and catch the open channel up;
`message` is `{ workspaceId, channelId, seq, threadRootId, authorId }`;
`update` (an edit or delete) is `{ workspaceId, channelId, messageId,
threadRootId }` and the client refetches that message; `channel` (a rename,
topic, archive or unarchive) is `{ workspaceId, channelId }` and the client
refetches its channel list; `ping` is a 25 s keep-alive. A public channel's
events go to every connected member of its workspace — any of them may read
it — and a private channel's or DM's to its members. Delivery across replicas is Postgres `LISTEN/NOTIFY` on the
`chat` channel (`ChatBus`), fanned out per replica by `ChatHub` to the
connected members of the channel from a member cache that a membership event
evicts, that expires after 60 s in case that event was lost, and that a
listener reconnect clears. A reconnect also sends `ready` down every open
stream, since whatever was NOTIFYed during the outage never arrived. On
`ready` the client re-reads the open channel's whole loaded range (so it
picks up missed edits and deletes, not only appends) and invalidates its
threads and other cached channels. A missed event costs latency, never
messages. The listener's connect and `LISTEN` are bounded at 10 s, so a
database that accepts TCP and then stalls reaches the retry path instead of
holding boot open.

### Webhooks (`/workspaces/:workspaceId/webhooks`)

Outbound, owner-managed webhooks: Wafflebase POSTs a thin, signed
[Standard Webhooks](https://www.standardwebhooks.com/) event when something
happens in the workspace (design:
[`docs/design/webhooks.md`](../../docs/design/webhooks.md)). All routes are
**JWT only** — a leaked `write`-scoped API key must not be able to register an
exfiltration endpoint — and every route except the list is **owner only**.
Another workspace's webhook or delivery id answers `404`.

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/workspaces/:wid/webhooks` | `{ enabled, canManage, webhooks }`; members get host-only rows (no `url`) |
| `POST` | `/workspaces/:wid/webhooks` | Create (`{ name, url, events, documentTypes, folderIds }`, empty list = all) → `{ webhook, test }` |
| `GET` | `/workspaces/:wid/webhooks/:id` | Detail |
| `PATCH` | `/workspaces/:wid/webhooks/:id` | Partial update → `{ webhook, test }`; `test` only when the URL changed |
| `DELETE` | `/workspaces/:wid/webhooks/:id` | Delete, deliveries included (`204`) |
| `POST` | `/workspaces/:wid/webhooks/:id/test` | Send a signed `webhook.test` now |
| `POST` | `/workspaces/:wid/webhooks/:id/reveal-secret` | `{ secret, previousSecret, previousExpiresAt }` |
| `POST` | `/workspaces/:wid/webhooks/:id/rotate-secret` | `{ overlapHours? }` (1–168, default 24); `409 rotation_in_progress` during an overlap |
| `POST` | `/workspaces/:wid/webhooks/:id/enable` | `{ recoverSince? }` re-queues failed deliveries created since then; the caller becomes `createdBy` |
| `POST` | `/workspaces/:wid/webhooks/:id/disable` | Turn off (`manual`); queued deliveries are marked failed |
| `GET` | `/workspaces/:wid/webhooks/:id/deliveries` | Delivery log, newest first (`?status=failed&before=&beforeId=&limit=`) |
| `GET` | `/workspaces/:wid/webhooks/:id/deliveries/:deliveryId` | One delivery with payload and response excerpt |
| `POST` | `/workspaces/:wid/webhooks/:id/deliveries/:deliveryId/redeliver` | Pull the next attempt to now, same `webhook-id` |
| `GET` | `/workspaces/:wid/members/:userId/removal-impact` | `{ privateChannelsDeleted, webhooksDisabled }` for the removal confirm (owner, or the member themself) |

Refusals carry a `code`: a URL the SSRF guard refuses is a `400` with
`{ code, message, address? }` (`private_address`, `scheme_not_allowed`,
`dns_failed`, …); the eleventh webhook is `409 limit_reached`; a redeliver on a
disabled webhook is `409 webhook_disabled`; a create without an encryption key
is `503 secrets_key_missing`.

**Delivery.** Events are written to `WebhookDelivery` inside the domain
write's transaction (a transactional outbox), and `pg_notify('webhook', …)`
wakes `WebhookDeliveryWorker` on every replica on commit, with a 5 s poll as
the fallback. Claims use `FOR UPDATE SKIP LOCKED` under one advisory lock, so
two replicas never send the same row and an endpoint never has more than two
requests open; rows are picked per webhook, so one webhook's backlog never
holds up another's. Sends go through `common/safe-outbound.ts`, which re-resolves
the host, connects only to the address it checked, refuses redirects, and
caps the response. Retries: immediately, 5 s, 5 m, 30 m, 2 h, 5 h, 10 h,
10 h (±10 %), then `failed`; a `410` turns the webhook off at once; a `429`
honours `Retry-After` up to an hour. A webhook failing for three days is
turned off, with a `webhook_failing` notification to every owner after two
days (always at least a day before the disable) and `webhook_disabled` when it
happens; a failure more than a day after the previous attempt starts a new
streak. Any disable fails the webhook's queued rows and records the oldest
as `recoverFrom`, the default re-enable recovery point. Delivery rows are kept 30 days. The per-webhook cap is 1,000
deliveries an hour; rows over it wait and the overflow is logged.

**`document.content_updated`** comes from the Yorkie `DocumentRootChanged`
webhook, which only upserts a `WebhookContentPending` row and returns. The
worker flushes a row once the document has been quiet for
`WAFFLEBASE_WEBHOOK_QUIET_MS`, or `WAFFLEBASE_WEBHOOK_MAX_WAIT_MS` after the
window opened. `/api/v1` content writes record their API key on that row
(`data.api_writers`), so an agent can recognize its own writes. The event has
no actor and is lost if Yorkie's event is.

### API Keys (`/workspaces/:workspaceId/api-keys`)

All API key endpoints require JWT authentication.

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/workspaces/:wid/api-keys` | JWT (Member) | Create API key (returns raw key once) |
| `GET` | `/workspaces/:wid/api-keys` | JWT (Member) | List non-revoked API keys — own, or all for an owner |
| `DELETE` | `/workspaces/:wid/api-keys/:id` | JWT (Member) | Revoke API key (soft-delete) — own, or any for an owner |

Minting is open to **any member**, not just the owner. A key authenticates as
the user who created it (`ApiKeyStrategy` puts `createdBy` into the request
identity) and `WorkspaceScopeGuard` re-checks that membership on every request,
so a member's key carries exactly the authority that member already holds in the
web UI — and `/api/v1` exposes no workspace administration for it to reach.
Gating minting on ownership bought no safety; it only shut members out of the
CLI and the v1 API.

Visibility and revocation are scoped by creator instead: a member sees and
revokes their own keys, an owner administers every key in the workspace. A
member naming somebody else's key gets **404, not 403** — whether this
workspace holds another member's integration is itself workspace information,
and there is no reason to leak it in order to justify a refusal.

A key dies with the membership that justified it:
`WorkspaceService.removeMember` revokes the departing member's keys outright,
and `WorkspaceScopeGuard` refuses any that survive out of band.

### REST API v1 (`/api/v1/`)

All v1 endpoints accept both JWT cookies and `Authorization: Bearer wfb_...` API key auth.

Every mutating v1 route (`POST` / `PUT` / `PATCH` / `DELETE`) additionally
requires the `write` scope from an API-key caller — enforced for the whole
surface by `ApiKeyWriteScopeGuard`, not per handler. JWT callers are
unaffected; their authority is workspace membership and document ownership.

#### Documents

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/v1/workspaces/:wid/documents` | List documents in workspace |
| `POST` | `/api/v1/workspaces/:wid/documents` | Create document (`{ title }`) |
| `GET` | `/api/v1/workspaces/:wid/documents/:did` | Get document metadata |
| `PATCH` | `/api/v1/workspaces/:wid/documents/:did` | Update document (`{ title }`) or file it (`{ folderId }`, `null` = root) |
| `POST` | `/api/v1/workspaces/:wid/documents/:did/copy` | Duplicate as `<title> (copy)` |
| `DELETE` | `/api/v1/workspaces/:wid/documents/:did` | Move to the trash; `?permanent=true` deletes a trashed document for good |
| `POST` | `/api/v1/workspaces/:wid/documents/:did/restore` | Restore a trashed document |

`PATCH` reads `title` and `folderId` independently — omitting `folderId` leaves
the document where it is, and `null` returns it to the workspace root. A rename
is open to any member; filing it elsewhere is manager-gated, matching the web
`PATCH /documents/:id`. There is no cross-workspace move on this surface: an
API key is bound to one workspace. `POST .../copy` runs the same
`DocumentCopyService` the web "Make a copy" does and is gated on membership
alone, since a copy never touches the source.

#### Folders

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/v1/workspaces/:wid/folders` | Create a folder (`{ name, parentId? }`) |
| `GET` | `/api/v1/workspaces/:wid/folders` | List folders (flat; `parentId` builds the tree) |
| `PATCH` | `/api/v1/workspaces/:wid/folders/:folderId` | Rename (`{ name }`) or move (`{ parentId }`, `null` = root) |
| `DELETE` | `/api/v1/workspaces/:wid/folders/:folderId` | Delete a folder |

The API-key-capable equivalent of the JWT-only folder routes above, delegating
to the same `FolderService` — so the cycle guard and the non-destructive delete
(descendants cascade, their documents return to the workspace root) are one
implementation. The routes are **nested under the workspace** rather than
copied as `folders/:id`, because `WorkspaceScopeGuard` is what refuses a key
minted for another workspace and it reads `:workspaceId` out of the path;
mounting `CombinedAuthGuard` on the bare web routes would leave nothing for it
to check. A folder in another workspace answers `404`, not `403`. Renaming is
open to any member, moving and deleting are manager-gated.

#### Files (blob documents)

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/v1/workspaces/:wid/files` | Upload any file as a document (multipart `file`, optional `title`, optional `folderId`) |
| `GET` | `/api/v1/workspaces/:wid/files/:documentId` | Download a blob document's bytes |

Upload stores the blob and creates the document in one call (deleting the blob
if the row fails) and derives `type` from the stored extension — `.pdf` →
`pdf`, `png|jpg|jpeg|gif|webp` → `image`, everything else → `file`. Nothing is
parsed: an uploaded `.xlsx` is stored as bytes. Download reuses
`fileResponseHeaders()`, so the derived-`Content-Type` rule is shared with
`GET /documents/:id/file`. Caps: 100 MB; 25 MB for images.

`title` defaults to the whole filename, **extension included** — a blob
document is the file, and the title is the only copy of an extension that
`safeExtension` rejects (a `.c++` blob is stored under a bare uuid). `folderId`
is optional and goes through the same `assertSameWorkspace` check the web
create path uses; both it and the title are resolved *before* the blob is
stored, so a rejected value costs no upload.

#### Tabs

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/v1/workspaces/:wid/documents/:did/tabs` | List tabs (id, name, type) |
| `POST` | `/api/v1/workspaces/:wid/documents/:did/tabs` | Create a sheet tab (`{ name?, type? }`; name auto-uniqued, omitted → next `SheetN`) |
| `PATCH` | `/api/v1/workspaces/:wid/documents/:did/tabs/:tid` | Rename a tab (`{ name }`; 404 missing, 400 blank, 409 duplicate) |

#### Cells

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `.../tabs/:tid/cells` | Get all cells (optional `?range=A1:C10`) |
| `GET` | `.../tabs/:tid/cells/:sref` | Get single cell |
| `PUT` | `.../tabs/:tid/cells/:sref` | Set single cell (`{ value, formula }`) |
| `DELETE` | `.../tabs/:tid/cells/:sref` | Delete single cell |
| `PATCH` | `.../tabs/:tid/cells` | Batch update (`{ cells: { "A1": {...}, "B2": null } }`) |

A reference the engine cannot parse is a `400` naming it, on every verb
that takes one, and a `cells` body that is missing, `null` or not an
object is a `400` as well. Both used to reach Nest's default filter as a
`500` (#1030). References are validated before the Yorkie document is
opened, so a bad one in a batch rejects the whole batch rather than
leaving it half applied.

A batch **entry** may be the object above, `null` (delete), or the bare
value every CLI recipe passes: `{"A1": "Name"}` is `{"A1": {"value":
"Name"}}`, and a leading `=` makes it a formula, the rule `toCellPatch`
already applies to an imported CSV cell. That shorthand used to reach the
write loop unread — `"Name".value` is `undefined` — so the documented
happy path wrote an **empty** cell and reported it as updated. An entry
that is neither (a boolean, an array) is a `400` rather than the same
quiet blanking.

#### Rows and columns

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `.../tabs/:tid/clear` | Empty a range, keeping structure (`{ range: "A1:C10" }`) |
| `POST` | `.../tabs/:tid/insert` | Insert rows/columns (`{ axis, index, count }`) |
| `POST` | `.../tabs/:tid/delete` | Delete rows/columns (`{ axis, index, count }`) |
| `POST` | `.../tabs/:tid/move` | Move rows/columns (`{ axis, srcIndex, count, dstIndex }`) |

`axis` is `"row"` or `"column"` and all indices are 1-based. Insert/delete/move
run the same `@wafflebase/sheets` helpers the editor does, so formulas, merges,
styles, validations, anchors, comment threads and the index-keyed view state
(filter range, hidden rows/columns, freeze pane) follow the edit — including
other tabs' chart and pivot source ranges. Bodies are validated before the
Yorkie document is opened.

The mutation runs synchronously inside one `doc.update()` on dense CRDT axis
arrays, so every request is bounded by the grid and each verb additionally by
whatever costs it work, capped at `MaxAxisEntries` (10,000, matching the
editor's `MaxAxisCoverage`): an insert by the entries it *materializes*
(measured against the axis's current length, so the cap is cumulative), a move
by `count` (its cost is the spliced block, not the growth — an axis that
already spans the block grows by nothing), and a delete by the grid alone,
since it materializes nothing and splices without a spread.

Two deliberate differences from the editor: cached formula values are
**cleared, not recalculated** (the calculator is async and needs a live
`Sheet`, so `GET .../cells` reports `value: null` for formula cells until an
editor session recalculates), and a move that would split a merged range is
refused with `409` instead of silently doing nothing. Structural edits on a
pivot-output tab or a `datasource`/`lakehouse` tab return `400`.

See [`docs/design/rest-api.md`](../../docs/design/rest-api.md) §5.4.

#### Board

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `.../documents/:did/board/elements` | Compact element list: `id`, `kind` (sticky / section / shape / freeform / text / connector / image / group / …), plain `text`, `color`, `frame`, innermost `section`, `stamps`, ended-vote `votes`, `author` (not on an anonymous board) |
| `POST` | `.../documents/:did/board/stickies` | Add stickies: `[{ text, color?, x?, y? }]`, or `{ texts, color?, near?, columns? }` laid out as a grid in free space → `{ ids }` |
| `POST` | `.../documents/:did/board/sections` | Add a section: `{ title, elementIds?, layout?: 'grid', at?, columns?, frame?, color? }` — wraps the elements, grids then wraps them, or fills `frame` → `{ id, frame, members, moved }` |
| `PATCH` | `.../documents/:did/board/elements` | Batch move / resize `[{ id, x, y, w?, h? }]`; a moved section carries its members, glued connectors follow → `{ moved, carried }` |
| `POST` | `.../documents/:did/board/text` | Add a text box `{ text, x?, y?, w?, fontSize?, bold?, near?, side? }` → `{ id, frame }` |

What an agent clusters a brainstorm with, through the CLI's `board elements`
/ `add-stickies` / `add-section` / `move` / `add-text`. Elements are built by
`@wafflebase/board`'s own factories (its `node` entry, which is why the image
builds `packages/board`), so they are the elements the canvas makes, and each
request is one `doc.update` of granular writes rather than a whole-board
replace. A non-board document is a `400`; an unknown element id a `404`; a
locked section, or anything in one, a `409` on move. A board past 50,000
top-level elements, or with sections stacked so deep over its elements that
membership would cost more than 2,000,000 checks, is a `400`. See
[`docs/design/rest-api.md`](../../docs/design/rest-api.md) §5.10.

## Auth Flow

```
1. Frontend links to GET /auth/github
2. GitHubAuthGuard mints an OAuth `state` and attaches it as __oauthState:
   a double-submit pair for the browser (secret in the
   `__Host-wafflebase_oauth_state` cookie, its SHA-256 sent as
   `web.<hash>`), or
   a CliAuthStore token for `?mode=cli`, paired with a secret in the
   `__Host-wafflebase_cli_state` cookie so the CLI state is bound to
   this browser too
3. Passport redirects to GitHub OAuth consent screen, carrying `state`
4. GitHub redirects to GET /auth/github/callback
5. GitHubStrategy validates profile, calls UserService.findOrCreateUser()
6. The callback requires `state`: the browser's must match its cookie
   (cleared on use), a CLI token must match its own
   `__Host-wafflebase_cli_state` cookie before it is consumed and
   redirected to the loopback port. A stateless or mismatched callback
   issues no session and returns the browser to
   FRONTEND_URL/login?error=oauth_state
7. AuthService signs access and refresh JWTs with { sub, username, email, photo }
8. Tokens are set as httpOnly cookies (`wafflebase_session`, `wafflebase_refresh`)
9. Response redirects to FRONTEND_URL
10. Frontend calls GET /auth/me on subsequent loads to verify session
11. If access token expires, frontend calls POST /auth/refresh and retries once
```

A CLI login (`GET /auth/github?mode=cli&port=…`) is unauthenticated and
takes its redirect target off the query string, so `CliLoginConfirmMiddleware`
answers it with a confirmation page first; only the click through it
(which carries the `__Host-wafflebase_cli_confirm` cookie secret back as
`?confirm=`) reaches the guard. Design:
[`docs/design/backend.md`](../../docs/design/backend.md).

## Database Schema

Key models managed by Prisma:

**User** — authenticated users (auto-created on first GitHub login)

| Column | Type | Notes |
|--------|------|-------|
| `id` | Int (PK) | Auto-increment |
| `authProvider` | String | `"github"` or `"google"` — where the row came from, not a constraint on later sign-ins (`findOrCreateUser` matches on email alone) |
| `username` | String | |
| `email` | String | Unique |
| `photo` | String? | Profile photo URL |

**Document** — a document of any type (sheet / doc / slides / note / board / pdf / image / file)

`type` is a **viewer-routing key** — "which viewer or editor opens this" — not
a file format. `pdf` and `image` are blobs with dedicated viewers; `file` is a
blob with none (see
[`docs/design/generic-file-upload.md`](../../docs/design/generic-file-upload.md)).

| Column | Type | Notes |
|--------|------|-------|
| `id` | String (PK) | UUID |
| `title` | String | |
| `type` | String | Document type, default `"sheet"` (sheet/doc/slides/note/board/pdf/image/file) |
| `fileId` | String? | Blob storage key for the blob-backed types (pdf/image/file) |
| `fileSize` | Int? | Blob size in bytes; null for the CRDT types |
| `mimeType` | String? | Client-reported blob MIME. Display data only — never a serving or access decision |
| `authorID` | Int? | FK to User |
| `workspaceId` | String | FK to Workspace (CASCADE) |
| `folderId` | String? | FK to Folder (`SetNull`); null = workspace root |
| `deletedAt` | DateTime? | Null while live; set when moved to the trash. `@@index([workspaceId, deletedAt])` |
| `createdAt` | DateTime | Auto-set |
| `updatedAt` | DateTime | Last-modified ordering, fed by the Yorkie event webhook |

**ApiKey** — workspace-scoped API keys for external access

| Column | Type | Notes |
|--------|------|-------|
| `id` | String (PK) | UUID |
| `name` | String | Human-readable label |
| `prefix` | String | First 8 chars of raw key |
| `hashedKey` | String | Unique, SHA-256 of full key |
| `workspaceId` | String | FK to Workspace (CASCADE) |
| `createdBy` | Int | FK to User |
| `scopes` | String[] | Default `["read", "write"]` |
| `lastUsedAt` | DateTime? | Updated on each auth |
| `expiresAt` | DateTime? | Optional expiration |
| `revokedAt` | DateTime? | Soft-revoke timestamp |
| `createdAt` | DateTime | Auto-set |

**Notification** — one in-app notification addressed at one user

| Column | Type | Notes |
|--------|------|-------|
| `id` | String (PK) | UUID |
| `type` | String | `comment_mention` / `comment_reply` / `thread_resolved` / `workspace_member_joined` / `template_approved` / `template_rejected` / `template_removed` / `template_needs_review` / `template_review_queued` / `chat_mention` / `chat_thread_reply` (channel id in `threadId`, message id in `commentId`) / `webhook_failing` / `webhook_disabled` (webhook id in `threadId`, no `documentId`) |
| `recipientId` | Int | FK to User (`Cascade`) |
| `actorId` | Int? | FK to User (`SetNull`) — the notification outlives a deleted actor |
| `workspaceId` | String | FK to Workspace (`Cascade`) |
| `documentId` | String? | FK to Document (`Cascade`) — a deleted document leaves no dead link |
| `threadId` / `commentId` | String? | Opaque CRDT identifiers; no FK, never resolved server-side |
| `dedupeKey` | String? | Comment id (required for mention/reply), or `<threadId>:resolved`. `@@unique([recipientId, type, dedupeKey])`, so a retried report creates no second row. Null for joins, which Postgres treats as distinct |
| `preview` | String? | Plain-text excerpt, ≤200 chars; control characters collapsed to spaces, zero-width and bidi characters removed |
| `readAt` | DateTime? | Null while unread |
| `createdAt` | DateTime | Auto-set. `@@index([recipientId, createdAt])` covers the list; `@@index([recipientId, readAt])` covers the unread badge, which would otherwise scan every row the recipient has ever received |

**TemplateListing** — a document published as a template

| Column | Type | Notes |
|--------|------|-------|
| `id` | String (PK) | UUID. For an `unlisted` listing this *is* the capability — 122 bits, same as a share token |
| `documentId` | String | Unique FK to Document (`Cascade`) — one listing per document, so publish is an upsert and a deleted document leaves no dead card |
| `workspaceId` | String | Publishing workspace, FK (`Cascade`). Denormalized so the workspace-tier query needs no join |
| `createdBy` | Int | FK to User |
| `shareLinkId` | String? | Unique FK to ShareLink (`SetNull`) — the non-expiring `viewer` link backing the preview |
| `title` / `description` / `category` / `tags` | | Gallery metadata; `title` seeds from the document title but is independently editable |
| `thumbnailId` | String? | Key in the image bucket, served by the unauthenticated `GET /images/:id` |
| `visibility` | String | `unlisted` / `workspace` / `public`. The *effective* tier; only an approval writes `public` |
| `status` | String | `listed` / `pending` / `rejected` / `removed`. The review state, moved on its own so submitting changes nothing a viewer can observe |
| `submittedAt` / `reviewedAt` / `reviewedBy` / `reviewNote` | | When it was submitted, and who decided what. `reviewNote` is the reason the publisher is notified with |
| `useCount` | Int | Incremented per successful use. A counter, not a ledger — a failed increment never fails the request |
| `licensedAt` | DateTime? | The publisher's grant that others may copy and modify. Required before `public` |
| `originId` | String? | The publisher's original, once `documentId` points at the frozen copy a public listing is promoted to |
| `publishedAt` / `createdAt` / `updatedAt` | DateTime | `@@index([visibility, status, useCount])` covers the public browse query; `@@index([workspaceId, visibility])` the workspace one |

**ChatChannel** — a public or private channel, or a DM

| Column | Type | Notes |
|--------|------|-------|
| `id` | String (PK) | UUID |
| `workspaceId` | String | FK to Workspace (`Cascade`) — a workspace takes its whole chat with it |
| `kind` | String | `public` / `private` / `dm` |
| `name` | String? | Null for a DM, which is labelled by its members. `@@unique([workspaceId, name])` |
| `topic` | String? | |
| `createdBy` | Int? | Creator; with workspace owners, the only one who may rename or archive |
| `archivedAt` | DateTime? | Set = read-only |
| `lastSeq` | BigInt | Last allocated message `seq`, bumped under the row lock |
| `dmKey` | String? | Unique; DM only, `<workspaceId>:<sorted member ids>`, so concurrent opens land in one channel |
| `defaultKey` | String? | Unique; the workspace id on its default channel (#general), null elsewhere. Created with the workspace, joined on invite accept, cannot be left or archived |
| `lastMessageAt` | DateTime? | Recency ordering (the DM list sorts by it) |
| `createdAt` | DateTime | Auto-set |

**ChatChannelMember** — one user's membership and read position

| Column | Type | Notes |
|--------|------|-------|
| `channelId` / `userId` | | Composite PK; both FKs `Cascade`. Removing a workspace member drops their rows in the same transaction |
| `lastReadSeq` | BigInt | Unread = top-level messages above it. Starts at the channel tail on join or invite |
| `joinedAt` | DateTime | Auto-set |

**ChatMessage** — a message or thread reply

| Column | Type | Notes |
|--------|------|-------|
| `id` | String (PK) | UUID |
| `channelId` | String | FK to ChatChannel (`Cascade`) |
| `seq` | BigInt | Per-channel monotonic; `@@unique([channelId, seq])`. The pagination and catch-up cursor |
| `authorId` | Int? | FK to User (`SetNull`) — a message survives its author |
| `apiKeyId` | String? | Reserved for posts made with an API key (P3) |
| `clientId` | String? | The poster's own id for a send; `@@unique([channelId, authorId, clientId])` makes a retry return the first copy |
| `body` | String | Plain text, mentions as canonical `@[username](userId)`. Cleared on soft delete |
| `threadRootId` | String? | Null = top-level |
| `alsoInChannel` | Boolean | A reply also shown in the channel flow |
| `replyCount` / `lastReplyAt` | | Thread summary on the root |
| `editedAt` / `deletedAt` | DateTime? | Soft delete keeps the row so `seq` stays gap-free and a root keeps its replies |
| `createdAt` | DateTime | Auto-set |

**ChatDocumentRef** — a document a message links to

| Column | Type | Notes |
|--------|------|-------|
| `messageId` / `documentId` | | Composite PK; both FKs `Cascade`, so a deleted message or document leaves no ref |
| `channelId` | String | The message's channel, denormalized (no FK) so the Files list reads `@@index([channelId, createdAt])` alone |
| `anchor` | Json? | The parsed `?at=` anchor (sheet axis ids / doc block / slide, plus a display `label`), null for a document-level link or one that did not parse |
| `createdAt` | DateTime | When it was first shared; an edit that keeps the link keeps it |

## Module Structure

```
src/
├── main.ts                    # Bootstrap: cookie-parser, CORS, listen
├── app.module.ts              # Root module (ConfigModule, AuthModule, DocumentModule)
├── auth/
│   ├── auth.module.ts         # JwtModule config, strategies, controller
│   ├── auth.controller.ts     # OAuth + session endpoints
│   ├── auth.service.ts        # JWT token creation
│   ├── github.strategy.ts     # Passport GitHub OAuth2 strategy
│   ├── github-auth.guard.ts   # Mints the OAuth `state` (web + CLI)
│   ├── oauth-state.ts         # Browser double-submit state cookie
│   ├── cli-auth.store.ts      # CLI login state/code store
│   ├── cli-login-confirm.middleware.ts # Consent gate for ?mode=cli
│   ├── jwt.strategy.ts        # Passport JWT-from-cookie strategy
│   └── jwt-auth.guard.ts      # Route guard
├── user/
│   ├── user.module.ts
│   └── user.service.ts        # User CRUD + findOrCreateUser
├── document/
│   ├── document.module.ts
│   ├── document.controller.ts # Document REST endpoints
│   └── document.service.ts    # Document CRUD
├── api-key/
│   ├── api-key.module.ts      # API key management module
│   ├── api-key.service.ts     # Key generation, hashing, validation
│   ├── api-key.controller.ts  # CRUD endpoints for API keys
│   ├── api-key.strategy.ts    # Passport custom strategy for wfb_ tokens
│   ├── api-key-auth.guard.ts  # AuthGuard('api-key')
│   └── combined-auth.guard.ts # Routes to JWT or API key guard
├── yorkie/
│   ├── yorkie.module.ts       # Global Yorkie client module
│   ├── yorkie.service.ts      # withDocument(id, cb) pattern
│   └── yorkie.types.ts        # SpreadsheetDocument, Worksheet, TabMeta
├── api/v1/
│   ├── api-v1.module.ts       # REST API v1 module
│   ├── documents.controller.ts # Document CRUD via API
│   ├── tabs.controller.ts     # Tab listing via Yorkie
│   ├── cells.controller.ts    # Cell CRUD via Yorkie
│   ├── files.controller.ts    # Blob document upload/download (any file)
│   ├── workspace-scope.guard.ts # Workspace access verification
│   └── api-key-write-scope.guard.ts # `write` scope on mutating routes
├── workspace/                 # Workspaces + members + sharing roles
├── folder/                    # Workspace folder tree (folder.md / workspace-folders.md)
├── share-link/                # URL-based token sharing (sharing.md)
├── template/                  # Template gallery: publish + use (template-gallery.md)
├── datasource/                # External PostgreSQL/MySQL/BigQuery datasources
├── file/                      # Blob storage for static file types (pdf)
├── image/                     # Image document type upload/serve (image-viewer.md)
├── analytics/                 # View-event Kafka producer + StarRocks reader (share-link-analytics.md)
├── notification/              # In-app notifications: REST + SSE, in-process hub (notifications.md)
├── webhook/                   # Workspace webhooks: outbox, delivery worker, management (webhooks.md)
├── chat/                      # Workspace chat: channels, DMs, messages, LISTEN/NOTIFY bus + SSE hub (chat.md)
├── user-doc-styles/           # Per-user default docs named styles
├── health/                    # Health-check endpoint
└── database/
    └── prisma.service.ts      # Prisma client lifecycle
```

## Further Reading

See [/docs/design/backend.md](../../docs/design/backend.md) for the full design document covering the auth system, security model, and API details.
