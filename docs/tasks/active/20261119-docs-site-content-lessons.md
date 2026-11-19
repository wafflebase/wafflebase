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

## Self review

- Round 1: 4 lenses approved (docs, correctness, design-fit, test-adequacy);
  security and blast-radius did not run (HTTP 429 usage limit), so the round
  is not clean. Fixed the minors: `--desktop` now defaults to STYLE.md's
  1440x900 and a bare `--width` errors; restored the documented
  `Cell writes …` 400 the backend comment pins; repointed backend comments
  off `developers/rest-api.md`; rewrote the design doc's stale Summary,
  Homepage Changes and Content Outline; added a test that every homepage
  `/docs/...` href lands on a real page, not a redirect stub. Disregarded:
  the docs-lens nit that `docs/design/docs-site.md` is missing (it is in the
  diff), and the design-fit nit about bundling the harness removal (it
  removes the tool whose images this change replaces).
- Round 2: all six lenses approved, no blocking findings — loop stopped.
  Fixed two minors anyway: STYLE.md still named the old `guide/` IA (flagged
  by design-fit and blast-radius), and the `--allow-unbound-callback` note
  understated who can finish an unchecked login (security). The rest are
  deferred to the PR body as known limitations.
- **Rebase can stale the docs you just verified.** #1175 landed on `main`
  during review and moved the board's Timer/Vote/Spotlight/Laser into a
  Facilitate group. Before opening a docs PR, diff `main` since the branch
  point for UI the pages describe, and refresh those pages + captures with a
  writer → independent checker pair again (here: 5 text fixes, 15 recaptures,
  5 checker corrections).
