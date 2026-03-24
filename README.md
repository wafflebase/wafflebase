# Wafflebase

Wafflebase is a web-based collaborative spreadsheet and word processor. It
bridges the gap between traditional spreadsheets and database tools, offering
real-time collaboration and scalable performance for handling large datasets.

> **Status:** Early development. Core spreadsheet and document editing features
> work, but the project is not yet production-ready. We are actively working on
> DataSource integration and advanced analysis features.

**Demo:** https://wafflebase.io/shared/bed3dbe8-bdce-46ef-a76e-65fd67178cde

## Features

### Sheets

- **High-performance rendering** — Canvas-based virtualized grid that handles
  large row/column counts smoothly.
- **Formulas** — ANTLR4-based formula engine with SUM, AVERAGE, MIN, MAX,
  and more.
- **Cell formatting** — Font, color, alignment, freeze panes.
- **Undo/Redo & Copy/Paste** — Google Sheets-compatible clipboard handling.
- **Data Source integration** *(coming soon)* — Connect directly to
  PostgreSQL/MySQL to query live data.

### Docs

- **Canvas-based word processor** — Rich text editing with inline formatting
  (bold, italic, underline, font size, color).
- **Pagination** — Word-processor-style pages with configurable paper size
  and margins.
- **Block editing** — Paragraph-level operations with alignment and line
  height controls.

### Shared

- **Real-time collaboration** — Multi-user editing powered by
  [Yorkie](https://yorkie.dev) CRDT.
- **Peer cursor labels** — See collaborators' cursors with name tags in
  real time.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, TailwindCSS, Radix UI |
| Sheets engine | Canvas rendering, ANTLR4 formula parser, Yorkie CRDT |
| Docs engine | Canvas rendering, custom layout & pagination |
| Backend | NestJS, Prisma, PostgreSQL, GitHub OAuth + JWT |

## Project Structure

```
packages/
  sheets/          — Core spreadsheet engine (data model, formulas, Canvas rendering)
  docs/            — Canvas-based document editor (rich text, inline formatting)
  frontend/        — React web app (pages, components, hooks)
  backend/         — NestJS API server (auth, documents, data sources)
  cli/             — Command-line interface for Wafflebase API
  documentation/   — VitePress documentation site (wafflebase.io/docs)
```

The frontend depends on `@wafflebase/sheets` and `@wafflebase/docs` as
workspace dependencies.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v22+
- [pnpm](https://pnpm.io/) v10+
- [Docker](https://www.docker.com/)

### 1. Install dependencies

```bash
pnpm install
```

### 2. Start infrastructure

Wafflebase depends on PostgreSQL and [Yorkie](https://yorkie.dev) for
real-time collaboration. Both run via Docker:

```bash
docker compose up -d
```

### 3. Configure environment

Create `packages/backend/.env`:

```env
FRONTEND_URL=http://localhost:5173
DATABASE_URL=postgresql://wafflebase:wafflebase@localhost:5432/wafflebase
JWT_SECRET=your_jwt_secret
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_CALLBACK_URL=http://localhost:3000/auth/github/callback
```

To obtain `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`, create a GitHub
OAuth App at https://github.com/settings/developers with the callback URL
above. See [`packages/backend/README.md`](packages/backend/README.md) for
the full list of environment variables.

### 4. Run migrations and start dev server

```bash
pnpm backend migrate
pnpm dev
```

Open http://localhost:5173 in your browser.

## Testing

Before submitting a PR, run the self-contained verification lane:

```bash
pnpm verify:self
```

This runs lint, unit tests, builds all packages, and checks chunk budgets,
visual regressions, and code entropy in one command. CI runs this
automatically and posts results as a PR comment.

For database-backed end-to-end tests (starts a temporary PostgreSQL
container):

```bash
pnpm verify:integration:docker
```

## Contributing

We welcome contributions! Check out open issues or propose new ideas.

### Commit messages

Commit messages should answer *what changed* and *why*:

```
Remove the synced seq when detaching the document

To collect garbage like CRDT tombstones left on the document, all
the changes should be applied to other replicas before GC. For this,
if the document is no longer used by this client, it should be
detached.
```

- Subject line: what changed, max 70 characters
- Body: why, wrapped at 80 characters

## License

[Apache License 2.0](LICENSE)
