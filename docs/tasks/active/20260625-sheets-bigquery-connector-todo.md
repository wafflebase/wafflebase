# TODO — BigQuery connector in sheets (③, single feature issue)

Design doc: [bigquery-connector.md](../../design/sheets/bigquery-connector.md) ·
Issue bodies: [20260625-sheets-external-data-sources-issues.md](20260625-sheets-external-data-sources-issues.md) ·
Epic index: [20260625-sheets-external-data-sources-todo.md](20260625-sheets-external-data-sources-todo.md)

Single feature issue (no subissues). The milestones below are internal, not
separate issues; may ship in 1–2 PRs, each `pnpm verify:fast` green. Extends the
existing PostgreSQL datasource pattern via the native `@google-cloud/bigquery`
client. Independent of Roadmaps ①②④. ~600–1000 LOC.

Each task lists **what / files / reuse / done**. Mirror
`packages/backend/src/datasource/` and `datasource-view.tsx`.

## Task breakdown (internal milestones, not subissues)

```
  M1 connection ─► M2 query ─► { M3 cost guardrails ★, M4 schema browser, M5 frontend, M6 refresh(later) }
```

### M1 — Connection model

**Goal:** store an encrypted BigQuery connection.
**Files:** `packages/backend/prisma/schema.prisma`,
`packages/backend/src/bigquery/` (new module), reuse `datasource/crypto.util.ts`.

- [ ] **`BigQuerySource` model + migration** — project, dataset, location,
  `credentials` (service-account JSON, AES-256-GCM), optional `maximumBytesBilled`,
  workspaceId, authorID. Done: CRUD; key encrypted + masked.
- [ ] **Module scaffold (controller/dto/service)** — workspace-scoped CRUD +
  `POST /:id/test`. Done: controller-contract e2e green.

### M2 — Query execution

**Goal:** run GoogleSQL and render read-only.
**Files:** `packages/backend/src/bigquery/bigquery.service.ts`, reuse
`datasource/sql-validator.ts`, `packages/sheets/src/store/readonly.ts`.

- [ ] **`@google-cloud/bigquery` client + auth** — add dep; authenticate from the
  decrypted service-account key. Done: a query runs against a test dataset.
- [ ] **Validate + map to response shape** — reuse SELECT/WITH validator
  (GoogleSQL) + 10k cap; map schema/rows → `{ columns:[{name,dataTypeID}], rows,
  rowCount, truncated, executionTime }`; STRUCT/ARRAY → JSON-string via `toCell`.
  Done: a SELECT renders read-only in a tab.

### M3 — Cost guardrails ★ (the defining BigQuery concern)

**Goal:** never let a runaway scan bill.
**Files:** `bigquery.service.ts`, frontend BigQuery view.

- [ ] **Dry-run estimate** — run `dryRun: true` first → `totalBytesProcessed`;
  return an estimate before execution. Done: estimate surfaced pre-run.
- [ ] **`maximumBytesBilled` ceiling** — per-connection + per-query cap passed to
  the job. Done: an over-ceiling query hard-fails with a clear message.
- [ ] **Warning UI** — banner + confirm when estimate exceeds a threshold. Done:
  user confirms before an expensive run.

### M4 — Schema browser

**Goal:** browse datasets/tables/columns.
**Files:** `bigquery.service.ts` (+ endpoint), frontend sidebar.

- [ ] **List datasets → tables → columns** — via the BigQuery metadata API. Done:
  sidebar lists; click inserts into the editor.

### M5 — Frontend

**Goal:** end-to-end UX.
**Files:** `packages/frontend/src/components/bigquery-dialog.tsx`,
`packages/frontend/src/app/spreadsheet/bigquery-view.tsx`, reuse datasource view.

- [ ] **`BigQueryDialog`** — project/dataset + service-account key upload + Test.
  Done: connection created from the UI.
- [ ] **SQL editor view + cost banner** — reuse the datasource view shell; show
  the dry-run estimate above Run. Done: create → query → results + estimate.

### M6 — Scheduled refresh / result cache (later)

- [ ] **Cache last result per tab; manual + optional interval refresh** — re-run
  shows a fresh estimate. Done: cached results reused; refresh re-runs.

## Acceptance (issue-level)

- Create connection → run a SELECT → read-only results with a pre-run cost estimate.
- Over-ceiling queries blocked; key encrypted at rest + masked.
- `pnpm verify:fast`; integration behind `RUN_BIGQUERY_INTEGRATION_TESTS` (free tier, repo secrets, never fork PRs).

## Cross-cutting

- [ ] `docs/design/README.md` updated (done on ideation branch)
- [ ] Lessons in `20260625-sheets-bigquery-connector-lessons.md`
- [ ] After merge: `pnpm tasks:archive && pnpm tasks:index`

## Review

(filled in at completion)
