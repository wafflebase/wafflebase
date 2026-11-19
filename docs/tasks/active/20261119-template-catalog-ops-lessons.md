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
