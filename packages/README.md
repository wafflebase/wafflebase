# Packages

Monorepo packages for Wafflebase.

## Engines (pure domain libraries)

| Package | Description |
|---------|-------------|
| [`sheets`](sheets/README.md) | Spreadsheet engine — data model, ANTLR4 formulas, Canvas rendering, `Store` abstraction. |
| [`docs`](docs/README.md) | Word processor engine — paragraph-level rich text, inline formatting, paginated Canvas rendering, `DocStore` abstraction. |
| [`slides`](slides/README.md) | Presentation engine — free-position elements, four-tier theme/master/layout model, Canvas + DOM overlay editor. |

## Apps & services

| Package | Description |
|---------|-------------|
| [`frontend`](frontend/README.md) | React 19 SPA — spreadsheet/docs/slides UI, Yorkie real-time collaboration, GitHub OAuth. |
| [`backend`](backend/README.md) | NestJS API server — GitHub OAuth + JWT sessions, document CRUD, REST API v1, API keys. |
| [`cli`](cli/README.md) | Go CLI (`wafflebase`) — terminal access to the REST API for data pipelines, scripting, import/export. |
| [`documentation`](documentation/README.md) | VitePress documentation site served at the `/docs/` subpath. |

See the root [README](../README.md) for project overview and [`docs/design/`](../docs/design/README.md) for architecture documents.
