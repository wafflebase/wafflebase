# Docs Site Content Overhaul — Lessons

Todo: [20261119-docs-site-content-todo.md](./20261119-docs-site-content-todo.md)

## Lessons

- **Audit agents over-split.** Six section audits proposed ~130 pages.
  Per-editor phone and troubleshooting pages, and a function page per
  category, multiply pages without adding content. Consolidate cross-cutting
  pages into one page with per-editor anchors before writing.
- **Fix the page map before fanning out writers.** Writers only cross-link
  correctly if every new URL is decided first (`pagemap.txt`), and the
  sidebar plus redirects stay coordinator-owned.
- **Screenshot environment: run this checkout, not whatever holds :5173.**
  :5173/:5174 belonged to another checkout with unmerged UI, so shots would
  not have matched `main`. Ran the frontend on :5180 with
  `FRONTEND_URL=http://localhost:5180` for backend CORS.
- **The backend failed to compile on a fresh branch** for two separate
  reasons: stale workspace `dist` (rebuild core/docs/slides/board) and a
  missing `@wafflebase/board` link (`pnpm install --frozen-lockfile`).
- **Never `pkill -f` a dev server pattern** on a machine running several
  checkouts — stop your own background task by id instead.
- `capture-docs-screenshots.mjs` wrote to `../docs/public/images`, a path
  left over from before the site moved to `packages/documentation`.
- **Sidebar labels in the page map become H1s.** I wrote noun labels
  ("Charts", "Sections") into `config.ts` before writing; STYLE.md says the
  H1 matches the sidebar, so every writer copied the noun and several flagged
  the conflict with "how-to titles start with a verb". Decide titles, not
  just URLs, before fanning out.
- **Writer → independent checker pipelines pay off.** Checkers corrected 136
  claims the writers had "verified" (a cell edit only syncs after Enter, an
  over-cap upload can't be retried, wrong CLI anchors). Never let the writer
  be its own fact-checker.
- **Screenshot lanes need a seeded cast.** The dev DB had one usable user, so
  collaboration shots fell back to anonymous share-link visitors and
  single-voter results. Seed a workspace with 2–3 fictional members before a
  capture run.
- **Concurrent capture agents in one workspace crowd each other's lists.**
  Give each lane its own folder up front.
- Removing a line from `package.json` with `sed` left a trailing comma, and
  pnpm failed to parse it, so the docs build silently didn't run. Check exit
  codes, not just grep output.
