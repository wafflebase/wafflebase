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
pnpm verify:fast                    # Lint + unit tests (local/default lane)
pnpm verify:full                    # Build + migrations + backend e2e lane
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

## High-Signal Entry Points

- `packages/sheet/src/model/sheet.ts` — core spreadsheet model behavior
- `packages/sheet/src/formula/formula.ts` — formula parse/evaluate pipeline
- `packages/sheet/src/view/worksheet.ts` — canvas worksheet rendering and input
- `packages/frontend/src/app/spreadsheet/sheet-view.tsx` — frontend sheet integration
- `packages/backend/src/auth/` — GitHub OAuth + JWT authentication flow

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
- In shell commits, do not place `\n` inside regular quoted `-m` strings.
  Use multiple `-m` flags or `$'...'` so body line breaks are real newlines.

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

Start from these indexes, then open specific docs only as needed.

- [`design/README.md`](design/README.md) — central index for architecture/design docs
- [`packages/sheet/README.md`](packages/sheet/README.md) — sheet engine concepts and APIs
- [`packages/frontend/README.md`](packages/frontend/README.md) — frontend structure and features
- [`packages/backend/README.md`](packages/backend/README.md) — backend modules and API behavior

## Operational Pitfalls

- Formula grammar changes require regeneration: run `pnpm sheet build:formula` and commit generated outputs.
- ANTLR-generated files intentionally include `@ts-nocheck`; do not hand-edit generated parser/lexer files.
- Backend and realtime flows assume local services are up (`docker compose up -d`) before running integration/e2e workflows.
- Spreadsheet behavior should go through the `Store` abstraction; avoid bypassing it with ad-hoc persistence paths.

## Task Documentation

- Track non-trivial tasks in `tasks/` using paired files:
  - `tasks/YYYYMMDD-<slug>-todo.md`
  - `tasks/YYYYMMDD-<slug>-lessons.md`
- Keep `tasks/README.md` updated when adding task files.
