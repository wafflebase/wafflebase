# Packages

Monorepo packages for Wafflebase.

## Engines (pure domain libraries)

| Package | Description |
|---------|-------------|
| [`sheets`](sheets/README.md) | Spreadsheet engine — data model, ANTLR4 formulas, Canvas rendering, `Store` abstraction. |
| [`docs`](docs/README.md) | Word processor engine — paragraph-level rich text, inline formatting, paginated Canvas rendering, `DocStore` abstraction. |
| [`slides`](slides/README.md) | Presentation engine — free-position elements, four-tier theme/master/layout model, Canvas + DOM overlay editor. |
| [`notes`](notes/README.md) | Markdown note engine — CodeMirror 6 source editor, live preview, whole note in a single Yorkie `Text`. |
| [`board`](board/README.md) | Infinite-canvas engine — boundless pan/zoom plane over the Slides scene engine, mounted through a single-synthetic-slide store adapter. |

## Shared foundation

| Package | Description |
|---------|-------------|
| [`core`](core/README.md) | Cross-engine primitives, exposed through subpaths only (`@wafflebase/core/tokens`, `/tokens.css`, `/geometry`, `/url`). No root entry point. |

## Apps & services

| Package | Description |
|---------|-------------|
| [`frontend`](frontend/README.md) | React 19 SPA — sheets/docs/slides/notes/board UI, Yorkie real-time collaboration, GitHub OAuth. |
| [`backend`](backend/README.md) | NestJS API server — GitHub OAuth + JWT sessions, document CRUD, REST API v1, API keys. |
| [`cli`](cli/README.md) | TypeScript CLI (`wafflebase`) — terminal access to the REST API for data pipelines, scripting, import/export. |
| [`documentation`](documentation/README.md) | VitePress documentation site served at the `/docs/` subpath. |

## Tooling

| Package | Description |
|---------|-------------|
| [`design-editor`](design-editor/README.md) | Dev-only Vite plugin — renders a project's real routes and writes edits back into its JSX and token source. Never shipped to production. |
| [`design-sandbox`](design-sandbox/README.md) | Wafflebase's own instance of that editor — the `@wafflebase/core` token adapter and the consumer Vite config. `private: true`, never published. |

See the root [README](../README.md) for project overview and [`docs/design/`](../docs/design/README.md) for architecture documents.
