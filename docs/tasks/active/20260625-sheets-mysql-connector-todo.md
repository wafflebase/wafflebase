# TODO — MySQL connector in sheets (④, single feature issue)

Design doc: [mysql-connector.md](../../design/sheets/mysql-connector.md) ·
Issue bodies: [20260625-sheets-external-data-sources-issues.md](20260625-sheets-external-data-sources-issues.md) ·
Epic index: [20260625-sheets-external-data-sources-todo.md](20260625-sheets-external-data-sources-todo.md)

Single feature issue (no subissues). Milestones below are internal; ~1 PR,
`pnpm verify:fast` green. Extends the existing PostgreSQL datasource to
MySQL/MariaDB via the native `mysql2` client behind an `engine` discriminator.
Independent of Roadmaps ①②③. ~250–450 LOC.

Each task lists **what / files / reuse / done**. This is the smallest connector:
almost everything is the existing `packages/backend/src/datasource/` module plus
one extra driver.

## Task breakdown (internal milestones, not subissues)

```
  M1 connection + query (foundation) ─► { M2 frontend, M3 schema browser, M4 test }
```

### M1 — Connection (engine discriminator) + query execution

**Goal:** run a MySQL SELECT read-only without breaking the Postgres path.
**Files:** `packages/backend/prisma/schema.prisma`,
`packages/backend/src/datasource/datasource.service.ts`,
`packages/backend/package.json`, reuse `datasource/sql-validator.ts` +
`crypto.util.ts`.

- [ ] **`engine` field + migration** — add `engine String @default("postgres")`
  to `DataSource`; existing rows default to postgres (backward compatible). Done:
  migration applies; Postgres connections unaffected.
- [ ] **`mysql2` dependency + driver dispatch** — add `mysql2`; the service picks
  `pg` vs `mysql2` by `engine`; default port by engine (5432/3306). Done: a MySQL
  connection connects.
- [ ] **Execute + map to response shape** — reuse the SELECT/WITH validator and
  `LIMIT 10001` + 10k cap; map `mysql2` fields/rows → `{ columns:[{name,dataTypeID}],
  rows, rowCount, truncated, executionTime }`; set `dateStrings: true` to avoid
  timezone shift (mirrors the Postgres raw-text approach). Done: a MySQL SELECT
  renders read-only; Postgres path unchanged.

### M2 — Frontend: engine selector

**Goal:** create a MySQL connection from the UI.
**Files:** `packages/frontend/src/components/datasource-dialog.tsx`,
`packages/frontend/src/app/spreadsheet/datasource-view.tsx`.

- [ ] **Engine selector + port default** — add a PostgreSQL/MySQL choice; the
  port field defaults by engine. Done: dialog creates a MySQL connection.
- [ ] **Reuse the datasource view** — MySQL tabs use the existing SQL editor /
  results grid unchanged. Done: create → tab → query → results end-to-end.

### M3 — Schema browser

**Goal:** browse MySQL tables/columns.
**Files:** `datasource.service.ts` (+ existing schema endpoint if present), frontend sidebar.

- [ ] **`information_schema` listing (engine-agnostic)** — the same
  `information_schema.tables/columns` queries work for MySQL. Done: browse + click
  to insert.

### M4 — Test

**Goal:** CI covers both engines locally, no cost.
**Files:** root `docker-compose.yml`, `packages/backend/test/datasource-*.e2e-spec.ts`.

- [ ] **MySQL docker-compose service** — alongside the existing Postgres service.
  Done: MySQL reachable in CI.
- [ ] **Run datasource integration against MySQL** — parameterize the suite over
  both engines behind `RUN_DB_INTEGRATION_TESTS`. Done: integration green for
  Postgres and MySQL.

## Acceptance (issue-level)

- Create a MySQL connection → tab → query → results end-to-end; Postgres path unaffected.
- Creds encrypted + masked; integration green for both engines; `pnpm verify:fast`.

## Cross-cutting

- [ ] `docs/design/README.md` updated (done on ideation branch)
- [ ] Consider updating root `README.md` "coming soon" copy when shipped
- [ ] Lessons in `20260625-sheets-mysql-connector-lessons.md`
- [ ] After merge: `pnpm tasks:archive && pnpm tasks:index`

## Review

(filled in at completion)
