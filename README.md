# Wafflebase

Wafflebase is a web-based collaborative office suite — spreadsheets, word
documents, and presentations. It offers real-time collaboration and scalable
performance, and bridges the gap between traditional spreadsheets and database
tools for handling large datasets.

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

### Slides

- **Free-position canvas** — Place text boxes, shapes, and images anywhere
  on a slide; reuses the Docs rich-text engine inside text boxes.
- **Themes & layouts** — 5 built-in themes and 11 Google Slides–parity
  layouts with placeholder identity tracking.
- **Canvas + DOM editor** — Two-pane editor (slide list + main canvas) with
  a DOM overlay for inline text editing.
- **Import & export** — Best-effort PPTX import and PDF export.

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
| Slides engine | Canvas + DOM-overlay editor, theme/master/layout model, reuses Docs rich-text engine in text boxes |
| Backend | NestJS, Prisma, PostgreSQL, GitHub OAuth + JWT |

## Project Structure

- [packages/sheets/](packages/sheets/README.md) — Core spreadsheet engine (data model, formulas, Canvas rendering)
- [packages/docs/](packages/docs/README.md) — Canvas-based document editor (rich text, inline formatting)
- [packages/slides/](packages/slides/README.md) — Presentation engine (free-position elements, themes/layouts, Canvas + DOM overlay)
- [packages/frontend/](packages/frontend/README.md) — React web app (pages, components, hooks)
- [packages/backend/](packages/backend/README.md) — NestJS API server (auth, documents, data sources)
- [packages/cli/](packages/cli/README.md) — Command-line interface for the Wafflebase API ([skills](packages/cli/skills/SKILL.md))
- [packages/documentation/](packages/documentation/README.md) — VitePress documentation site (wafflebase.io/docs)

The frontend depends on `@wafflebase/sheets`, `@wafflebase/docs`, and
`@wafflebase/slides` as workspace dependencies.

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

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for the
full workflow — issue triage, design docs, verification lanes, commit
conventions, and how AI coding agents fit in.

## Documentation

- [docs/](docs/README.md) — design documents, architecture, and task tracking
- [CONTRIBUTING.md](CONTRIBUTING.md) — contributor workflow
- [MAINTAINING.md](MAINTAINING.md) — release and maintenance procedures
- [CLAUDE.md](CLAUDE.md) — agent instructions for AI-assisted development (also exposed as `AGENTS.md` via symlink)

## License

[Apache License 2.0](LICENSE)
