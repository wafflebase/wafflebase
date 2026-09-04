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
COOKIE_SECURE=                          # Optional. Whether session and login
                                        # cookies carry `Secure` (and so the
                                        # `__Host-` prefix). Unset — the normal
                                        # case — derives it from
                                        # GITHUB_CALLBACK_URL's scheme, since
                                        # that is where GitHub redirects the
                                        # login and so is this server's public
                                        # scheme; with no callback URL set at
                                        # all it falls back to
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
YORKIE_AUTH_WEBHOOK_ENFORCE=false       # Optional. false (default) = shadow
                                        # mode: log the access decision but
                                        # never deny. true = enforce per-doc
                                        # access at the Yorkie auth webhook.
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
WAFFLEBASE_STARROCKS_DSN=               # Optional, StarRocks DSN
                                        # (`user:pass@tcp(host:port)/db`) for
                                        # the analytics warehouse query path.
                                        # Unset disables the document
                                        # analytics dashboard (returns
                                        # `enabled: false`).
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

Roll out with `YORKIE_AUTH_WEBHOOK_ENFORCE=false` first (shadow mode — logs the
decision it *would* make), confirm no false denials, then flip to `true`.
Unregister the methods (`--auth-webhook-method-rm ALL`) to disable. Shadow mode
allows every request regardless of the computed decision, so a deployment that
registers the revision methods but leaves `YORKIE_AUTH_WEBHOOK_ENFORCE=false`
is not protected — an anonymous viewer share link can still list, read, and
restore a document's revision history until enforcement is flipped on.

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
| `DELETE` | `/documents/:id` | Delete document (manager: workspace owner or author) |

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
- `YORKIE_AUTH_WEBHOOK_ENFORCE` must be `true`. In shadow mode the preview
  token a public card hands every visitor also grants *write* access to the
  document, and since an edit returns a listing to review, one request per card
  would empty the gallery into a queue only a human can drain.

`PUBLIC_TIER_OPEN` (`src/template/template-review.ts`) stays as a constant
rather than being deleted: it is the one line to flip if the gallery has to be
shut for a moderation incident or a migration, without reverting a feature or
teaching every deployment a new setting.

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

### API Keys (`/workspaces/:workspaceId/api-keys`)

All API key endpoints require JWT authentication.

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/workspaces/:wid/api-keys` | JWT (Owner) | Create API key (returns raw key once) |
| `GET` | `/workspaces/:wid/api-keys` | JWT (Member) | List non-revoked API keys |
| `DELETE` | `/workspaces/:wid/api-keys/:id` | JWT (Owner) | Revoke API key (soft-delete) |

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
| `DELETE` | `/api/v1/workspaces/:wid/documents/:did` | Delete document |

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
`GET /documents/:id/file`. Caps are unchanged (50 MB; 25 MB for images).

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
| `authProvider` | String | e.g. `"github"` |
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
| `type` | String | `comment_mention` / `comment_reply` / `thread_resolved` / `workspace_member_joined` / `template_approved` / `template_rejected` / `template_removed` / `template_needs_review` / `template_review_queued` |
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
├── user-doc-styles/           # Per-user default docs named styles
├── health/                    # Health-check endpoint
└── database/
    └── prisma.service.ts      # Prisma client lifecycle
```

## Further Reading

See [/docs/design/backend.md](../../docs/design/backend.md) for the full design document covering the auth system, security model, and API details.
