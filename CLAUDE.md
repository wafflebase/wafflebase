# CLAUDE.md — Wafflebase

Wafflebase is a web-based collaborative office suite — spreadsheets,
word documents, and presentations. Yorkie CRDTs for real-time
collaboration, ANTLR4-based formula engine, Canvas rendering.

- **Sheets** — Spreadsheet engine (data model, ANTLR4 formulas, Canvas grid rendering)
- **Docs** — Word processor engine (rich text, Canvas rendering, pagination)
- **Slides** — Presentation engine (free-position elements, theme system, Canvas + DOM overlay editor); reuses the docs rich-text engine inside text boxes

See @docs/design/README.md for architecture, @packages/sheets/README.md,
@packages/docs/README.md, @packages/slides/README.md,
@packages/frontend/README.md, @packages/backend/README.md
for package details.

## Commands

```bash
pnpm install                        # Install all dependencies
docker compose up -d                # Start PostgreSQL + Yorkie server
pnpm dev                            # Start frontend (:5173) + backend (:3000)
pnpm verify:fast                    # Lint + unit tests (pre-commit gate)
pnpm verify:self                    # verify:fast + all builds
pnpm verify:full                    # verify:self + integration (DB required)
pnpm verify:browser:docker          # Visual + interaction tests in Docker
pnpm verify:e2e                     # Playwright behavioral e2e (needs backend with WAFFLEBASE_E2E_AUTH=1)
pnpm verify:e2e:standalone          # One-shot: boots backend + frontend + runs e2e
pnpm test                           # Sheets package tests only (Vitest)
pnpm sheets build:formula           # IMPORTANT: regenerate ANTLR formula parser
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
- **Store abstraction** — all spreadsheet behavior must go through the `Store` interface, all document behavior through `DocStore`. Do not bypass with ad-hoc persistence.
- **Integration/e2e tests** require `docker compose up -d` first.
- **Frontend chunk-gate** defaults are in `harness.config.json`; override with `FRONTEND_CHUNK_LIMIT_KB` / `FRONTEND_CHUNK_COUNT_LIMIT`.

## Task Workflow

Non-trivial tasks use paired files in `docs/tasks/active/`:
`YYYYMMDD-<slug>-todo.md` and `YYYYMMDD-<slug>-lessons.md`. Architecture
changes go to `docs/design/<topic>.md`. Code lands via PR, not direct
push to `main`.

1. **Plan** — write the todo file before touching code; update `docs/design/` if architecture changes.
2. **Branch + commit** — feature branch from `main`; each commit `pnpm verify:fast` green (commit format above).
3. **Self review** — dispatch a code review skill (e.g. `superpowers:requesting-code-review` or `/code-review`) over the full branch diff before pushing. Apply blocking findings; note non-blocking as known limitations.
4. **Sync + open PR** — `git fetch && git rebase origin/main` to surface conflicts before pushing. Title ≤70 chars; body = Summary + Test plan.
5. **Address review** — evaluate each finding technically; push back with reasoning when wrong. Reply in the comment thread (`gh api repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies`), not top-level. If `main` moved during review, rebase again.
6. **Before merge** — CI green and review approved: manual smoke in `pnpm dev` if UI changed; capture lessons in `*-lessons.md`, archive (`pnpm tasks:archive && pnpm tasks:index`), commit + push. Merge, then start a new session for the next task.
