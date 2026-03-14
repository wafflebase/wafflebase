# CLAUDE.md — Wafflebase

Wafflebase is a web-based collaborative spreadsheet (Google Sheets alternative).
Yorkie CRDTs for real-time collaboration, ANTLR4-based formula engine, Canvas rendering.

See @docs/design/README.md for architecture, @packages/sheet/README.md,
@packages/frontend/README.md, @packages/backend/README.md for package details.

## Commands

```bash
pnpm install                        # Install all dependencies
docker compose up -d                # Start PostgreSQL + Yorkie server
pnpm dev                            # Start frontend (:5173) + backend (:3000)
pnpm verify:fast                    # Lint + unit tests (pre-commit gate)
pnpm verify:self                    # verify:fast + all builds
pnpm verify:full                    # verify:self + integration (DB required)
pnpm verify:browser:docker          # Visual + interaction tests in Docker
pnpm test                           # Sheet package tests only (Vitest)
pnpm sheet build:formula            # IMPORTANT: regenerate ANTLR formula parser
pnpm backend migrate                # Run Prisma database migrations
```

## Commit Messages

Subject ≤70 chars (what changed). Body explains why. Blank line 2.
In shell, use multiple `-m` flags or `$'...'` for real newlines — not `\n` in `"..."`.

```text
Remove the synced seq when detaching the document

To collect garbage like CRDT tombstones left on the document, all
the changes should be applied to other replicas before GC. For this,
if the document is no longer used by this client, it should be
detached.
```

## Pitfalls

- **ANTLR generated files** have `@ts-nocheck` — do NOT hand-edit or add type fixes. Regenerate with `pnpm sheet build:formula` and commit the output.
- **Store abstraction** — all spreadsheet behavior must go through the `Store` interface. Do not bypass with ad-hoc persistence.
- **Integration/e2e tests** require `docker compose up -d` first.
- **Frontend chunk-gate** defaults are in `harness.config.json`; override with `FRONTEND_CHUNK_LIMIT_KB` / `FRONTEND_CHUNK_COUNT_LIMIT`.

## Design Specs

Write design/feature specs to `docs/specs/` (e.g., `docs/specs/YYYY-MM-DD-<topic>-design.md`).

## Task Workflow

Non-trivial tasks use paired files in `docs/tasks/active/`:
- `YYYYMMDD-<slug>-todo.md` and `YYYYMMDD-<slug>-lessons.md`

Before marking done:
1. Update `docs/design/` if architecture changed
2. Run `pnpm verify:fast` and confirm pass
3. Archive: `pnpm tasks:archive && pnpm tasks:index`
