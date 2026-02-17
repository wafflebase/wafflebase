# CLAUDE.md — Wafflebase

This file provides context for AI assistants working on this codebase.

## Project

Wafflebase is a web-based collaborative spreadsheet application (Google Sheets alternative).
It uses Yorkie CRDTs for real-time collaboration and an ANTLR4-based formula engine.

## Monorepo Structure

```
packages/
  sheet/      — Core spreadsheet engine (data model, formulas, Canvas rendering)
  frontend/   — React 19 web app (Vite, TailwindCSS, Radix UI)
  backend/    — NestJS API server (Prisma, PostgreSQL, GitHub OAuth + JWT)
```

The frontend depends on `@wafflebase/sheet` as a workspace dependency.

## Commands

### Development

```bash
pnpm install                # Install all dependencies
docker compose up -d        # Start PostgreSQL + Yorkie server
pnpm dev                    # Start frontend (:5173) + backend (:3000)
```

### Testing

```bash
pnpm test                           # Run sheet package tests (Vitest)
pnpm backend test                   # Run backend tests (Jest)
pnpm backend test:e2e               # Run backend e2e tests
```

### Building

```bash
pnpm build                          # Build all packages
pnpm sheet build                    # Build sheet library only
pnpm frontend build                 # Build frontend only
pnpm backend build                  # Build backend only
```

### Other

```bash
pnpm sheet build:formula            # Regenerate ANTLR formula parser
pnpm backend migrate                # Run Prisma database migrations
```

## Key Files

- `packages/sheet/src/model/sheet.ts` — Main Sheet class (core data model)
- `packages/sheet/src/formula/formula.ts` — Formula parser and evaluator
- `packages/sheet/src/formula/functions.ts` — Built-in spreadsheet functions
- `packages/sheet/src/formula/antlr/Formula.g4` — ANTLR grammar definition
- `packages/sheet/src/view/worksheet.ts` — Canvas-based worksheet renderer
- `packages/sheet/src/store/store.ts` — Store interface (MemStore / YorkieStore)
- `packages/frontend/src/app/spreadsheet/sheet-view.tsx` — Spreadsheet React component
- `packages/frontend/src/app/spreadsheet/yorkie-store.ts` — Yorkie store implementation
- `packages/backend/src/auth/` — GitHub OAuth2 + JWT authentication
- `packages/backend/prisma/schema.prisma` — Database schema

## Conventions

- **File names**: kebab-case (`sheet-view.tsx`, `auth.service.ts`)
- **Classes/interfaces**: PascalCase (`Sheet`, `Store`, `DocumentService`)
- **Functions/variables**: camelCase (`getCell`, `updateActiveCell`)
- **Backend**: NestJS module-per-feature pattern (auth, user, document)
- **Frontend pages**: `src/app/` directory, reusable UI in `src/components/ui/`
- **Environment variables**: backend uses `.env`, frontend uses `VITE_*` prefix

### Commit Message Format

Use commit messages that answer two questions: what changed and why.

- Subject line: describe what changed, max 70 characters.
- Body: describe why the change was needed.
- Keep line 2 blank.
- Wrap body lines at 80 characters.

Example:

```text
Remove the synced seq when detaching the document

To collect garbage like CRDT tombstones left on the document, all
the changes should be applied to other replicas before GC. For this,
if the document is no longer used by this client, it should be
detached.
```

## Architecture Notes

- **Store abstraction**: The `Store` interface decouples the spreadsheet engine from persistence. `MemStore` is for dev/testing, `YorkieStore` is for production with real-time sync.
- **Formula engine**: ANTLR4 grammar generates a parser. A visitor pattern evaluates the AST. Error types: `#VALUE!`, `#REF!`, `#N/A!`, `#ERROR!`.
- **Rendering**: The spreadsheet grid is drawn on HTML Canvas for performance.
- **Real-time collaboration**: Yorkie CRDT handles conflict-free merging. Presence tracking shows other users' active cells.
- **Auth flow**: GitHub OAuth redirect → callback → user upsert in DB → JWT token set as cookie.
- **ANTLR generated files**: Have `@ts-nocheck` at the top — do not remove this or add type fixes to generated files. Regenerate with `pnpm sheet build:formula`.

## Documentation

Each package has a README for getting started, and the `design/` directory has in-depth technical documents.

### Package READMEs

- [`packages/sheet/README.md`](packages/sheet/README.md) — Architecture, key concepts, public API, dev commands
- [`packages/frontend/README.md`](packages/frontend/README.md) — Tech stack, app structure, routing, features
- [`packages/backend/README.md`](packages/backend/README.md) — API endpoints, auth flow, database schema

### Design Documents

- [`design/README.md`](design/README.md) — Index of all design documents
- [`design/sheet.md`](design/sheet.md) — Data model, Store interface, formula engine, rendering pipeline, coordinate system
- [`design/formula-and-calculator.md`](design/formula-and-calculator.md) — Formula parsing/evaluation, dependency recalculation, and cross-sheet reference behavior
- [`design/frontend.md`](design/frontend.md) — Yorkie integration, presence system, auth flow, document management
- [`design/backend.md`](design/backend.md) — Module architecture, API reference, auth system, security model
- [`design/scroll-and-rendering.md`](design/scroll-and-rendering.md) — Viewport-based Canvas rendering, proportional scroll remapping
- [`design/batch-transactions.md`](design/batch-transactions.md) — Store-level batch transactions for atomic undo/redo
- [`design/sharing.md`](design/sharing.md) — URL-based token sharing with anonymous access and role-based permissions
- [`design/datasource.md`](design/datasource.md) — External PostgreSQL datasources, multi-tab documents, SQL editor, ReadOnlyStore

IMPORTANT: Always refer to these documents for architectural context and design decisions. And We should keep them up to date after making changes.
