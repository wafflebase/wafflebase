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
```

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
```

`test:e2e` includes database-backed tests for datasource/share-link services.
Set `RUN_DB_INTEGRATION_TESTS=true` and provide a reachable `DATABASE_URL`
before running it.

It covers both DB-backed service integration and authenticated HTTP integration
through JWT guards/controllers for core datasource/share-link/document flows.

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
| `GET` | `/documents` | List all documents for authenticated user |
| `GET` | `/documents/:id` | Get document by ID (owner only) |
| `POST` | `/documents` | Create a new document (`{ title }`) |
| `DELETE` | `/documents/:id` | Delete document (owner only) |

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

Two models managed by Prisma:

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
└── database/
    └── prisma.service.ts      # Prisma client lifecycle
```

## Further Reading

See [/design/backend.md](../../design/backend.md) for the full design document covering the auth system, security model, and API details.
