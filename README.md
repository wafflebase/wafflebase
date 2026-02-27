# wafflebase

Wafflebase is a web-based spreadsheet application designed to be a lightweight yet powerful tool for data analysis. It bridges the gap between traditional spreadsheets and database tools, offering real-time collaboration and scalable performance for handling large datasets.

## Status of Wafflebase

Wafflebase is currently in the early stages of development. While core spreadsheet functionalities are implemented, it is not yet ready for production use. We are actively working on DataSource integration and advanced analysis features.

Demo Sheet: https://wafflebase.io/shared/bed3dbe8-bdce-46ef-a76e-65fd67178cde

## Key Features
Currently, Wafflebase supports the following core capabilities:

- ⚡️ High Performance: Virtualized rendering engine designed to handle large row/column counts smoothly.
- 📊 Core Spreadsheet Functions:
  - Essential Formulas (SUM, AVERAGE, MIN, MAX)
  - Cell Formatting (Font, Color, Alignment) & Freeze Panes
  - Reliable Undo/Redo & Copy/Paste (Google Docs compatible)
- 🤝 Real-Time Collaboration: Multi-user editing powered by Yorkie (CRDT).
- 🔌 Data Source Integration (Coming Soon): Connect directly to databases (PostgreSQL, MySQL) to query and analyze live data without CSV exports.

## Contributing

We welcome contributions! If you're interested in helping build the next generation of data analysis tools, please check out the below or look for open issues.

### Commit Message Format

We follow a rough convention for commit messages that is designed to answer
two questions: what changed and why. The subject line should feature the what
and the body of the commit should describe the why.

```
Remove the synced seq when detaching the document

To collect garbage like CRDT tombstones left on the document, all
the changes should be applied to other replicas before GC. For this,
if the document is no longer used by this client, it should be
detached.
```

The first line is the subject and should be no longer than 70 characters. The
second line is always blank, and other lines should be wrapped at 80
characters.

### Setting Development Environment

Follow these instructions to set up your development environment.

#### Prerequisites

You need to have the following software installed on your system:

- [Node.js](https://nodejs.org/en/) (version 18 or later)
- [pnpm](https://pnpm.io/) (version 10 or later)
- [Docker](https://www.docker.com/) (for running the application in a container)

#### Building & Testing

```bash
pnpm i
pnpm run build
pnpm run test
pnpm run verify:architecture
pnpm run verify:fast
pnpm run verify:self
pnpm run verify:frontend:chunks  # checks built frontend JS chunk sizes
pnpm run verify:frontend:visual  # checks SSR visual snapshot regressions
pnpm run verify:frontend:visual:browser # checks browser-rendered snapshots
pnpm run verify:frontend:visual:all # runs both visual lanes
pnpm run verify:frontend:interaction:browser # checks browser interaction flows
pnpm run verify:integration   # requires PostgreSQL
pnpm run verify:integration:local  # skips when local PostgreSQL is unavailable
pnpm run verify:integration:docker # starts postgres, runs integration, stops
pnpm run verify:full          # alias: verify:self + verify:integration
```

Quick verify guide:
- Use `pnpm run verify:self` as the default pre-PR lane.
- Use `pnpm run verify:frontend:visual:all` to run SSR + browser visual checks.
- Use `pnpm run verify:frontend:interaction:browser` to run deterministic
  browser interaction checks (cell input/formula input/wheel scroll).
- Browser visual lane captures deterministic desktop + mobile baselines.
- Browser lanes need one-time Chromium install per environment:
  `pnpm --filter @wafflebase/frontend exec playwright install chromium`
- Use `pnpm run verify:integration` (or `:local` / `:docker`) for DB-backed e2e.

`verify:frontend:chunks` uses defaults from `harness.config.json`
(`maxChunkKb=500`, `maxChunkCount=60`) and supports
`FRONTEND_CHUNK_LIMIT_KB` / `FRONTEND_CHUNK_COUNT_LIMIT` overrides.

#### Running

Wafflebase depends on [Yorkie](https://yorkie.dev) and [Postgres](https://www.postgresql.org/). You can run them locally using Docker.

```bash
docker compose up -d
```

Create `packages/backend/.env` with the required environment variables:

```env
FRONTEND_URL=http://localhost:5173
DATABASE_URL=postgresql://wafflebase:wafflebase@localhost:5432/wafflebase
JWT_SECRET=your_jwt_secret
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_CALLBACK_URL=http://localhost:3000/auth/github/callback
```

To obtain `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`, create a GitHub OAuth App at https://github.com/settings/developers with the callback URL above.

See [`packages/backend/README.md`](packages/backend/README.md) for the full list of environment variables including optional ones.

Run database migrations and start the dev server:

```bash
pnpm backend migrate
pnpm run dev
```

Then open `http://localhost:5173` in your browser.
