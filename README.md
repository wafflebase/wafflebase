# Wafflebase

Wafflebase is a web-based collaborative office suite — spreadsheets, word
documents, presentations, markdown notes, and an infinite canvas, plus viewers
for uploaded PDFs, images, and other files. It offers real-time collaboration
and scalable performance, and bridges the gap between traditional spreadsheets
and database tools for handling large datasets.

> **Status:** Actively developed, pre-1.0. Wafflebase ships tagged releases,
> publishes [`@wafflebase/cli`](packages/cli/README.md) to npm and a
> `yorkieteam/wafflebase` image to Docker Hub, and runs the public site at
> [wafflebase.io](https://wafflebase.io). Every document type below works
> today, including external PostgreSQL and lakehouse data sources — but there
> is no 1.0 release and we don't call it production-ready yet.

**Demo:** https://wafflebase.io/shared/bed3dbe8-bdce-46ef-a76e-65fd67178cde

## Features

### Sheets

- **High-performance rendering** — Canvas-based virtualized grid that handles
  large row/column counts smoothly.
- **Formulas** — ANTLR4-based formula engine with a 462-entry catalog
  (445 functions plus 17 operators) spanning math, statistical, lookup,
  text, date, financial, engineering, and database categories.
- **Cell formatting** — Font, color, alignment, freeze panes, conditional
  formatting, and data validation with in-cell checkbox / dropdown / date
  controls.
- **Charts & pivot tables** — Bar, line, area, pie, and scatter charts
  anchored to the grid, plus pivot tables.
- **File import** — `.xlsx` (including styles), CSV, JSON, and Parquet.
- **Undo/Redo & Copy/Paste** — Google Sheets-compatible clipboard handling.
- **Data Source integration** — Query an external PostgreSQL database from a
  datasource tab, or read Iceberg / Delta tables out of object storage (S3,
  S3-compatible, GCS, Azure, or a local path) through the lakehouse
  connector.

### Docs

- **Canvas-based word processor** — Rich text editing with inline formatting
  (bold, italic, underline, font size, color).
- **Pagination** — Word-processor-style pages with configurable paper size
  and margins.
- **Block editing** — Paragraph-level operations with alignment and line
  height controls, plus tables, images, headers/footers, and spell check.
- **Import & export** — DOCX import and export, and PDF export.

### Slides

- **Free-position canvas** — Place text boxes, images, tables, connectors,
  and any of 137 insertable shapes anywhere on a slide; reuses the Docs
  rich-text engine inside text boxes.
- **Themes & layouts** — 23 built-in themes and 11 Google Slides–parity
  layouts with placeholder identity tracking.
- **Canvas + DOM editor** — Two-pane editor (slide list + main canvas) with
  a DOM overlay for inline text editing.
- **Presentation mode** — Fullscreen player with keyboard and click
  navigation.
- **Import & export** — Best-effort PPTX import, plus PPTX and PDF export.

### Notes

- **Markdown editor** — CodeMirror 6 source editor with a live preview,
  backed by a single Yorkie `Text` CRDT.

### Board

- **Infinite canvas** — Boundless pan/zoom plane reusing the Slides scene
  engine, with sticky notes, shapes, images, and connectors.
- **Miro import** — Best-effort structured import of a Miro board.

### Files

- **PDF, image, and generic file documents** — Upload any file as a
  document; PDFs and images get dedicated viewers, everything else is
  stored and downloadable.

### Shared

- **Real-time collaboration** — Multi-user editing powered by
  [Yorkie](https://yorkie.dev) CRDT.
- **Peer cursor labels** — See collaborators' cursors with name tags in
  real time.
- **Comments** — Threaded comments with `@user` mentions and in-app
  notifications.
- **Version history** — Browse, preview, and restore past revisions of any
  CRDT document type.
- **Sharing** — URL-based share links with viewer/editor roles and
  anonymous access, on top of workspaces, folders, and a template gallery.
- **CLI & REST API** — Workspace-scoped API keys, a `/api/v1/` surface, and
  the [`wafflebase`](packages/cli/README.md) command-line client.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, TailwindCSS, Radix UI |
| Sheets engine | Canvas rendering, ANTLR4 formula parser, Yorkie CRDT |
| Docs engine | Canvas rendering, custom layout & pagination |
| Slides engine | Canvas + DOM-overlay editor, theme/master/layout model, reuses Docs rich-text engine in text boxes |
| Notes engine | CodeMirror 6 source editor, single Yorkie `Text` CRDT |
| Board engine | Slides scene engine under an injected pan/zoom viewport |
| Backend | NestJS, Prisma, PostgreSQL, GitHub OAuth + JWT |

## Project Structure

- [packages/sheets/](packages/sheets/README.md) — Core spreadsheet engine (data model, formulas, Canvas rendering)
- [packages/docs/](packages/docs/README.md) — Canvas-based document editor (rich text, inline formatting)
- [packages/slides/](packages/slides/README.md) — Presentation engine (free-position elements, themes/layouts, Canvas + DOM overlay)
- [packages/notes/](packages/notes/README.md) — Markdown note engine (CodeMirror source editor, live preview)
- [packages/board/](packages/board/README.md) — Infinite-canvas engine (boundless pan/zoom over the Slides scene engine)
- [packages/core/](packages/core/README.md) — Shared foundation, subpath exports only (tokens, geometry, url, image)
- [packages/frontend/](packages/frontend/README.md) — React web app (pages, components, hooks)
- [packages/backend/](packages/backend/README.md) — NestJS API server (auth, documents, data sources)
- [packages/cli/](packages/cli/README.md) — Command-line interface for the Wafflebase API ([skills](packages/cli/skills/SKILL.md))
- [packages/documentation/](packages/documentation/README.md) — VitePress documentation site (wafflebase.io/docs)
- [packages/design-editor/](packages/design-editor/README.md) — Dev-only Vite plugin that edits a project's JSX and design tokens in place
- [packages/design-sandbox/](packages/design-sandbox/README.md) — Wafflebase's own instance of that editor (private, never published)
- [packages/debug-report/](packages/debug-report/README.md) — Framework-agnostic core for reporting a defect from the running screen (item model, session, capture store, host seam)

Per-package detail lives in [packages/README.md](packages/README.md). The
frontend depends on all five engines — `@wafflebase/sheets`, `@wafflebase/docs`,
`@wafflebase/slides`, `@wafflebase/notes`, `@wafflebase/board` — plus
`@wafflebase/core` as workspace dependencies. Among the engines, `slides` builds
on `docs` and `board` builds on `slides`; `notes` stands alone.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v22+
- [pnpm](https://pnpm.io/) v10+
- [Docker](https://www.docker.com/)

The repository ships an [`.nvmrc`](.nvmrc), so if you use
[nvm](https://github.com/nvm-sh/nvm) you can select the expected Node
version with:

```bash
nvm install   # first run only — installs the version in .nvmrc
nvm use
```

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

This runs lint, unit tests, builds all packages, and checks chunk budgets
and code entropy in one command. CI runs this automatically and posts
results as a PR comment.

Browser visual and interaction tests are a **separate** lane — `verify:self`
does not run them:

```bash
pnpm verify:browser:docker      # visual + interaction, in Docker
pnpm verify:frontend:visual     # the visual suite alone, locally
```

For database-backed end-to-end tests (starts PostgreSQL, MinIO, and
Azurite containers for you):

```bash
pnpm verify:integration:docker
```

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for the
full workflow — issue triage, design docs, verification lanes, commit
conventions, and how AI coding agents fit in.

## Documentation

- [docs/](docs/README.md) — design documents, architecture, and task tracking
- [scripts/](scripts/README.md) — verification harness, task-doc tooling, agent pipeline, git hooks
- [CONTRIBUTING.md](CONTRIBUTING.md) — contributor workflow
- [MAINTAINING.md](MAINTAINING.md) — release and maintenance procedures
- [CLAUDE.md](CLAUDE.md) — agent instructions for AI-assisted development (also exposed as `AGENTS.md` via symlink)

## Going further

The repository also runs an agent development loop — how work enters, how it is
reviewed, and what runs each part: [docs/design/agentic-dev-loop.md](docs/design/agentic-dev-loop.md).

## License

[Apache License 2.0](LICENSE)
