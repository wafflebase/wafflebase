---
title: Local development
description: Start the full Wafflebase stack on localhost with Docker Compose and the dev servers.
type: how-to
---

# Local development

Start the full Wafflebase stack on `localhost` with Docker Compose and three dev servers.

::: info Before you start
- Install Node.js 22, pnpm 10.5.2, and Docker with Compose v2. See [Requirements](/developers/self-hosting/#requirements).
- Create a GitHub OAuth app with the callback URL `http://localhost:3000/auth/github/callback`. See [Set up GitHub sign-in](/developers/self-hosting/sign-in#set-up-github-sign-in).
:::

## Clone and install

1. Clone the repository and install dependencies:

   ```bash
   git clone https://github.com/wafflebase/wafflebase.git
   cd wafflebase
   pnpm install
   ```

2. Build the shared core package, which the editors and the backend import from its build output:

   ```bash
   pnpm core build
   ```

   Run it again after you pull changes to `packages/core`.

## Start the infrastructure

1. Start the default services:

   ```bash
   docker compose up -d
   ```

| Service | Ports | Purpose |
|---------|-------|---------|
| `postgres` | `5432` | PostgreSQL 16 (user, password, and database are all `wafflebase`) |
| `yorkie` | `8080`, `8081` | Document sync (`8080` RPC, `8081` profiling) |
| `minio` | `9000`, `9001` | S3-compatible blob storage (`9000` API, `9001` console; `minioadmin` / `minioadmin`) |
| `azurite` | `10000` | Azure Blob emulator, used only by the lakehouse integration tests |

To skip the Azure emulator, start only what the app needs:

```bash
docker compose up -d postgres yorkie minio
```

The analytics services (`kafka`, `starrocks`) start only with `--profile analytics`. See [Turn on share-link analytics](/developers/self-hosting/optional-features#turn-on-share-link-analytics).

## Create the backend configuration

1. Create `packages/backend/.env` with the six required values:

   ```env
   DATABASE_URL=postgresql://wafflebase:wafflebase@localhost:5432/wafflebase
   JWT_SECRET=change-me
   GITHUB_CLIENT_ID=your_github_client_id
   GITHUB_CLIENT_SECRET=your_github_client_secret
   GITHUB_CALLBACK_URL=http://localhost:3000/auth/github/callback
   FRONTEND_URL=http://localhost:5173
   ```

Outside production, blob storage falls back to the local MinIO container and Yorkie to `http://localhost:8080`, so you need nothing else to start. The frontend's committed `packages/frontend/.env` already points at `localhost`. Every other variable is in [Configuration](/developers/self-hosting/configuration).

## Create the database schema

1. Apply the migrations:

   ```bash
   pnpm backend migrate
   ```

::: warning
`pnpm backend migrate` runs `prisma migrate dev`, which can generate migration files and offer to reset the database. Use it only on a development database. Production uses `prisma migrate deploy`; see [Run database migrations](/developers/self-hosting/deploy#run-database-migrations).
:::

## Start the dev servers

1. Start everything:

   ```bash
   pnpm dev
   ```

2. Open `http://localhost:5173` and click **Continue with GitHub**.

| Server | Port | Run on its own |
|--------|------|----------------|
| Frontend (Vite) | `5173` | `pnpm frontend dev` |
| Backend (NestJS, watch mode) | `3000` | `pnpm backend start:dev` |
| Documentation (VitePress) | `5174` | `pnpm documentation dev` |

The frontend proxies `/docs` to the documentation server, so the in-app help links work only while it runs. Signing in for the first time creates your account and your first workspace.

![Wafflebase sign-in page served from localhost:5173 with the Continue with GitHub button](/images/developers/self-hosting/local-login.png)

## Run the tests

| Command | What it runs |
|---------|--------------|
| `pnpm verify:fast` | Lint and unit tests |
| `pnpm test` | Unit tests across all packages |
| `pnpm backend test:e2e` | Backend end-to-end tests. Database-backed suites need `RUN_DB_INTEGRATION_TESTS=true`, and Yorkie-attached ones `RUN_YORKIE_INTEGRATION_TESTS=true` |

## Related

- [Configuration](/developers/self-hosting/configuration) for every backend and frontend variable.
- [Sign-in providers](/developers/self-hosting/sign-in) to add Google sign-in.
- [Troubleshooting](/developers/self-hosting/troubleshooting) if the backend does not start.
- [`CONTRIBUTING.md`](https://github.com/wafflebase/wafflebase/blob/main/CONTRIBUTING.md) for the development workflow.
