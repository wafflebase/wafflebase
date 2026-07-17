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
PORT=3000
LOG_LEVEL=info                          # Optional, Pino level
BACKEND_TRUST_PROXY=0                   # Optional, set to 1 behind a proxy
BACKEND_JSON_BODY_LIMIT=25mb            # Optional, body-parser limit
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
  --auth-webhook-method-add RemoveDocument
```

Roll out with `YORKIE_AUTH_WEBHOOK_ENFORCE=false` first (shadow mode — logs the
decision it *would* make), confirm no false denials, then flip to `true`.
Unregister the methods (`--auth-webhook-method-rm ALL`) to disable.

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
| `GET` | `/auth/github` | - | Initiate GitHub OAuth flow |
| `GET` | `/auth/github/callback` | - | OAuth callback, sets access/refresh cookies, redirects to frontend |
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
| `DELETE` | `/documents/:id` | Delete document (manager: workspace owner or author) |

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

### API Keys (`/workspaces/:workspaceId/api-keys`)

All API key endpoints require JWT authentication.

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/workspaces/:wid/api-keys` | JWT (Owner) | Create API key (returns raw key once) |
| `GET` | `/workspaces/:wid/api-keys` | JWT (Member) | List non-revoked API keys |
| `DELETE` | `/workspaces/:wid/api-keys/:id` | JWT (Owner) | Revoke API key (soft-delete) |

### REST API v1 (`/api/v1/`)

All v1 endpoints accept both JWT cookies and `Authorization: Bearer wfb_...` API key auth.

#### Documents

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/v1/workspaces/:wid/documents` | List documents in workspace |
| `POST` | `/api/v1/workspaces/:wid/documents` | Create document (`{ title }`) |
| `GET` | `/api/v1/workspaces/:wid/documents/:did` | Get document metadata |
| `PATCH` | `/api/v1/workspaces/:wid/documents/:did` | Update document (`{ title }`) |
| `DELETE` | `/api/v1/workspaces/:wid/documents/:did` | Delete document |

#### Tabs

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/v1/workspaces/:wid/documents/:did/tabs` | List tabs (id, name, type) |

#### Cells

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `.../tabs/:tid/cells` | Get all cells (optional `?range=A1:C10`) |
| `GET` | `.../tabs/:tid/cells/:sref` | Get single cell |
| `PUT` | `.../tabs/:tid/cells/:sref` | Set single cell (`{ value, formula }`) |
| `DELETE` | `.../tabs/:tid/cells/:sref` | Delete single cell |
| `PATCH` | `.../tabs/:tid/cells` | Batch update (`{ cells: { "A1": {...}, "B2": null } }`) |

## Auth Flow

```
1. Frontend links to GET /auth/github
2. Passport redirects to GitHub OAuth consent screen
3. GitHub redirects to GET /auth/github/callback
4. GitHubStrategy validates profile, calls UserService.findOrCreateUser()
5. AuthService signs access and refresh JWTs with { sub, username, email, photo }
6. Tokens are set as httpOnly cookies (`wafflebase_session`, `wafflebase_refresh`)
7. Response redirects to FRONTEND_URL
8. Frontend calls GET /auth/me on subsequent loads to verify session
9. If access token expires, frontend calls POST /auth/refresh and retries once
```

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

**Document** — spreadsheet documents

| Column | Type | Notes |
|--------|------|-------|
| `id` | String (PK) | UUID |
| `title` | String | |
| `authorID` | Int? | FK to User |
| `createdAt` | DateTime | Auto-set |

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
│   └── workspace-scope.guard.ts # Workspace access verification
└── database/
    └── prisma.service.ts      # Prisma client lifecycle
```

## Further Reading

See [/docs/design/backend.md](../../docs/design/backend.md) for the full design document covering the auth system, security model, and API details.
