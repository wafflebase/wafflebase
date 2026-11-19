# Template Catalog: Operations Templates — Lessons

Todo: [20261119-template-catalog-ops-todo.md](./20261119-template-catalog-ops-todo.md)

## Lessons

- **`scripts/tasks-archive.mjs` has no `--help`.** Running it with any
  argument archives every finished task in the repo (20 here), not one.
  Archive only your own task: move its two files by hand or restore the
  others afterwards, then `pnpm tasks:index`.
- **Check a source document has content before picking it.** Two of the
  first sheet picks were empty: a screenshot agent created them and never
  filled them. Count cells (`/api/v1 .../cells`) before choosing.
- Reading a sheet: the document route is `/s/<id>`, not `/w/<slug>/d/<id>`
  (that renders blank).
- **Render a seed before trusting it.** Tests and validators passed, yet the
  editor showed clipped sheet values (no column widths in a seed), a tip
  that put a new row outside the SUM range, and a truncated board section
  title. A local `seed:templates` into a scratch workspace + one screenshot
  per seed caught all of them.

## Self review

- Round 1: all six lenses approved, no blocking findings — loop stopped.
  Fixed one minor: `boards.spec.ts` checked a hand-kept list of boards, so a
  new board could skip the layout rules; it now takes every catalogue board
  and excludes `retrospective-board` by name (it predates sections). Deferred
  to the PR body: Team Directory counts its placeholder rows as people, the
  expense splitter assumes three flatmates unless rows are inserted inside
  the range, and the new sheet tests check cached arithmetic, not formula
  strings.
