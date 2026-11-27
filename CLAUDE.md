# CLAUDE.md — Wafflebase

Wafflebase is a web-based collaborative office suite: spreadsheets, word
documents, presentations, markdown notes, an infinite-canvas board, and
PDF/image/file viewers. Real-time collaboration runs on Yorkie CRDTs,
editors render to Canvas, and spreadsheets use an ANTLR4 formula engine.

Packages: `sheets` (formulas, grid), `docs` (rich text, pagination),
`slides` (reuses the docs text engine), `notes` (CodeMirror, one Yorkie
`Text`), `board` (reuses the slides scene engine), `core`, `frontend`
(React/Vite), `backend` (NestJS/Prisma), `cli`, `desktop`, `documentation`.
PDF/image/file are blob document types with no CRDT.

## Where to read

Read the relevant one before working in that area:

- [docs/design/README.md](docs/design/README.md) — design-doc index and
  architecture.
- [sheets](packages/sheets/README.md), [docs](packages/docs/README.md),
  [slides](packages/slides/README.md),
  [frontend](packages/frontend/README.md) package READMEs.
- [packages/backend/README.md](packages/backend/README.md) — env vars, API
  routes, Yorkie auth webhook, template seeding.

Area rules in `.claude/rules/` load on their own when you touch files their
`paths:` match. Link reference docs like these; an `@` import puts the whole
file into every session (`pnpm verify:instruction-budget` caps it).

## Commands

```bash
pnpm install                        # Install all dependencies
docker compose up -d                # Start PostgreSQL, Yorkie, MinIO, Azurite
pnpm dev                            # Start frontend (:5173) + backend (:3000) + docs site
pnpm verify:fast                    # Lint + unit tests (pre-commit gate)
pnpm verify:self                    # verify:fast + all builds + chunk/entropy (no browser lane)
pnpm verify:full                    # verify:self + browser + integration (DB required)
pnpm verify:browser:docker          # Visual + interaction tests in Docker
pnpm test                           # Unit tests across all packages (Vitest; backend is Jest)
pnpm sheets build:formula           # Regenerate ANTLR formula parser
pnpm backend migrate                # Run Prisma database migrations
```

Integration/e2e tests need `docker compose up -d` first.

## Git hooks

- `.githooks/pre-commit` runs `pnpm verify:fast`.
- `.githooks/pre-push` runs `pnpm verify:self` (~2.5 min). Run `git push`
  in the background with a long timeout.
- `.githooks/commit-msg` enforces the commit format below.

## Commit messages

- Subject ≤70 chars, says what changed. Line 2 blank. Body lines ≤80 chars,
  explain why.
- In shell, use multiple `-m` flags or `$'...'`, not `\n` inside `"..."`.

## Pitfalls

- ANTLR generated files under packages/sheets/antlr carry `@ts-nocheck`.
  Never hand-edit them; regenerate with `pnpm sheets build:formula` and
  commit the output.
- All spreadsheet behavior goes through the `Store` interface, all document
  behavior through `DocStore`. No ad-hoc persistence.

## Task workflow

- Non-trivial task: write paired `docs/tasks/active/YYYYMMDD-<slug>-todo.md`
  and `-lessons.md` before touching code.
- Architecture changes go to `docs/design/<topic>.md`.
- Work on a feature branch from `main`; code lands via PR only.
- Before the PR, run `/self-review` (bounded loop; procedure in
  .claude/commands/self-review.md).
- Opening, reviewing, and merging a PR: use the ship-pr skill (rebase, PR
  body, Before → After for phone UI via the pr-before-after skill, review
  replies, pre-merge archive).
- A PR gets no automated review unless you ask: the panel admits only
  `agent/*` branches and PRs labelled `agent:managed`. Comment
  `@claude review` (advisory, once per commit) or `@claude loop`
  (panel + auto-fix).
