# TODO — Lakehouse connector in sheets (Roadmap ②)

Design doc: [lakehouse-connected-sheet.md](../../design/sheets/lakehouse-connected-sheet.md) · Epic index: [20260625-sheets-external-data-sources-todo.md](20260625-sheets-external-data-sources-todo.md)

Reads open table formats (Iceberg/Delta) from object storage via embedded
DuckDB, with a time-travel slider. Reuses the datasource read-only spine.

Each subissue is one PR. Every task lists **what / files / reuse / done** so a
contributor can pick it up without reading the whole design doc. Paths are the
intended targets; mirror the existing `packages/backend/src/datasource/` module
and `packages/frontend/src/app/spreadsheet/datasource-view.tsx`.

## Subissue dependency graph

```
  LH-0 · DuckDB engine  ── foundational; also unblocks File Import FI-2/3/4
   ├─► LH-1 · Iceberg read + connection model
   │     ├─► LH-2 · format auto-detect (needs LH-1; Delta cases mockable until LH-3)
   │     ├─► LH-3 · Delta read
   │     ├─► LH-4 · catalog mode ──► LH-7 · catalog/table browser + polish
   │     ├─► LH-5 · time-travel slider ──► LH-9 · Hudi via XTable (later)
   │     └─► LH-8 · test strategy (emulators + parity)
   └─► LH-6 · object-storage backends (S3/GCS/Azure/MinIO)  [shared with FI-4]
```

---

## LH-0 — Embedded DuckDB engine in backend  ·  depends on: —

**Goal:** an in-process DuckDB usable by the backend, proven against Iceberg &
Delta on MinIO, with time-travel syntax pinned.
**Primary files:** `packages/backend/src/lakehouse/duckdb.service.ts` (new),
`packages/backend/package.json`, root `docker-compose.yml`, backend image build.

- [ ] **Verification spike (throwaway script).**
  Scope: read latest rows + history + a past version for one Iceberg and one
  Delta table on a local MinIO; confirm exact syntax (`iceberg_scan(...)`,
  `delta_scan(..., version => N)`, `TIMESTAMP AS OF`, `iceberg_snapshots(...)`).
  Files: scratch script + a temporary MinIO `docker-compose` service.
  Done: findings (syntax + version pins) written back into the design doc; no
  product code committed.
- [ ] **DuckDB singleton + connection pool.**
  Scope: a `DuckDbService` owning one DuckDB instance and lending pooled
  connections; `INSTALL`/`LOAD iceberg, delta, httpfs, azure` once on module
  init (never per request). Add `@duckdb/node-api` dependency.
  Files: `packages/backend/src/lakehouse/duckdb.service.ts`, `package.json`.
  Done: service injectable; a unit test runs `SELECT 42` through a pooled conn.
- [ ] **Extension loading for CI/locked networks.**
  Scope: ensure extensions auto-load offline (pre-bundle or vendored path);
  document the env for air-gapped deploys.
  Done: integration runs with no network extension fetch.
- [ ] **DuckDB binary in the backend image.**
  Scope: add the native binary to the backend Docker build; match runtime platform.
  Files: backend `Dockerfile` / CI image step.
  Done: container boots and loads extensions.

**Acceptance:** an integration test reads a committed Iceberg + Delta fixture
from MinIO through `DuckDbService`; engine reusable by LH-1; `pnpm verify:fast`.

---

## LH-1 — Connection model + Iceberg read  ·  depends on: LH-0

**Goal:** create an encrypted lakehouse connection and render an Iceberg table
read-only in a new tab.
**Primary files:** `packages/backend/prisma/schema.prisma`,
`packages/backend/src/lakehouse/` (module/service/controller/dto),
`packages/sheets/src/model/workbook/worksheet-document.ts`,
`packages/frontend/src/app/spreadsheet/lakehouse-view.tsx`,
`packages/frontend/src/components/{lakehouse-dialog,lakehouse-selector,tab-bar}.tsx`,
`packages/frontend/src/api/lakehouse.ts`.

- [ ] **`LakehouseSource` Prisma model + migration.**
  Scope: model per design §2 (name, format, storage, endpoint, region, bucket,
  basePath, catalogMode, catalogUri, credentials, workspaceId, authorID).
  Reuse: `src/datasource/crypto.util.ts` to encrypt `credentials`. Run
  `pnpm backend migrate`.
  Done: CRUD persists; `credentials` stored encrypted, masked in API responses.
- [ ] **Lakehouse backend module (service/controller/dto).**
  Scope: mirror `src/datasource/`; endpoints `POST|GET|PATCH|DELETE
  /workspaces/:wid/lakehouse-sources`, `POST /:id/test`, `POST /:id/read`;
  workspace-membership guard.
  Reuse: datasource controller/dto patterns, `combined-auth` guard.
  Done: controller-contract e2e green; non-members get 403.
- [ ] **Iceberg read via `iceberg_scan`.**
  Scope: `read` executes direct-metadata Iceberg through `DuckDbService`; wrap
  `SELECT * FROM (...) LIMIT 10001`, set 10k truncation flag + statement/connection
  timeouts; scan-only validation.
  Reuse: `src/datasource/sql-validator.ts`. Output the shared
  `{ columns:[{name,dataTypeID}], rows, rowCount, truncated, executionTime }`.
  Done: returns correct rows for the Iceberg fixture.
- [ ] **Sheets: lakehouse tab type + `TabMeta` fields + Yorkie migration.**
  Scope: add `"lakehouse"` to `TabType`; add `lakehouseSourceId`,
  `lakehouseRef`, `asOf` to `TabMeta` (design §1). Make
  `worksheet-shape-migration.ts` tolerate old documents missing these fields
  (leave them `undefined`; no backfill) and add a migration test case.
  Files: `packages/sheets/src/model/workbook/worksheet-document.ts`,
  `packages/backend/src/yorkie/worksheet-shape-migration.ts` (+ its `.spec.ts`).
  Done: types compile; old docs migrate cleanly; a lakehouse tab round-trips
  through Yorkie.
- [ ] **Frontend: dialog + selector + view + tab entry.**
  Scope: `LakehouseDialog` (create/edit connection + Test), `LakehouseSelector`
  (pick when adding a tab), `LakehouseView` (loads `/read` results into a
  `ReadOnlyStore` and renders), "New Lakehouse" item in `tab-bar.tsx`, and an
  `api/lakehouse.ts` client.
  Reuse: `datasource-view.tsx`, `datasource-dialog.tsx`, `datasource-selector.tsx`,
  `ReadOnlyStore` + `toCell`.
  Done: user creates a connection → adds a lakehouse tab → sees rows.

**Acceptance:** Iceberg connection on MinIO → tab → rows render; creds encrypted
+ masked; workspace-scoped; `pnpm verify:fast`; integration behind
`RUN_LAKEHOUSE_INTEGRATION_TESTS`.

---

## LH-2 — Format auto-detect + manual override  ·  depends on: LH-1, LH-3

**Goal:** the user doesn't have to declare Iceberg vs Delta for a direct path.
**Primary files:** `packages/backend/src/lakehouse/lakehouse.service.ts`,
`packages/frontend/src/components/lakehouse-dialog.tsx`.

- [ ] **Path-marker detection.**
  Scope: on `test`/`read`, list the table root and detect `_delta_log/` → Delta,
  `metadata/` + `*.metadata.json` → Iceberg, `.hoodie/` → Hudi (unsupported).
  Done: returns a `detectedFormat` for fixtures of each type.
- [ ] **`format` becomes `auto | iceberg | delta` (default `auto`) + override.**
  Scope: model/UI field; catalog mode skips detection (catalog implies format).
  Done: override respected; `.hoodie/` yields a clear "Hudi unsupported" error.

**Acceptance:** Delta & Iceberg auto-detected; override works; Hudi rejected
clearly; `pnpm verify:fast`.

---

## LH-3 — Delta read  ·  depends on: LH-1

**Goal:** read Delta tables, reusing all LH-1 infrastructure.
**Primary files:** `packages/backend/src/lakehouse/lakehouse.service.ts`, test fixtures.

- [ ] **`delta_scan` read path.**
  Scope: `format=delta` branch calling `delta_scan(...)` through `DuckDbService`;
  same wrap/limit/timeout/response as Iceberg.
  Done: a Delta fixture renders read-only.
- [ ] **Delta test fixtures.**
  Scope: commit a tiny Delta table (≥3 versions) under test fixtures + a regen note.
  Done: used by LH-8 parity/time-travel tests.

**Acceptance:** Delta table renders read-only; `pnpm verify:fast`.

---

## LH-4 — Catalog mode (Iceberg REST / S3 Tables)  ·  depends on: LH-1

**Goal:** connect to a managed catalog and list its tables.
**Primary files:** `packages/backend/src/lakehouse/lakehouse.service.ts` + controller.

- [ ] **Attach Iceberg REST catalog / S3 Tables.**
  Scope: when `catalogMode != direct-metadata`, `ATTACH` the catalog (OAuth2/ARN
  via stored creds) and read `<ns>.<table>`.
  Done: a REST-catalog table renders.
- [ ] **`GET /:id/tables` (catalog listing).**
  Scope: list namespaces/tables from the catalog for the picker.
  Done: endpoint returns the table list for a test catalog.

**Acceptance:** REST-catalog Iceberg renders; tables list returns; `pnpm verify:fast`.

---

## LH-5 — Time-travel slider  ·  depends on: LH-1 (ideally LH-3)

**Goal:** drag a slider over commit history to view the table *as of* a commit.
**Primary files:** `packages/backend/src/lakehouse/lakehouse.{service,controller}.ts`,
`packages/frontend/src/app/spreadsheet/lakehouse-view.tsx` + a new
`TimeTravelSlider` component, `packages/sheets/.../worksheet-document.ts` (asOf persist).

- [ ] **History endpoint `GET /:id/history`.**
  Scope: return `[{ ref, timestamp, operation, summary? }]` from
  `iceberg_snapshots(...)` (Iceberg) / Delta history.
  Done: ordered timeline for a ≥3-commit fixture.
- [ ] **`/read` accepts `asOf` → time-travel SQL.**
  Scope: emit `delta_scan(version=>N)` / `TIMESTAMP AS OF` / Iceberg snapshot
  selection per `TimeTravelPoint`.
  Done: `asOf` version N returns the historical row set; timestamp resolves to
  commit-at-or-before.
- [ ] **`TimeTravelSlider` UI + Yorkie persistence.**
  Scope: discrete stops = commits (label = timestamp + operation), "Latest" at
  the right; on change call `/read` with the new `asOf`, reload the
  `ReadOnlyStore`, and write `asOf` to `TabMeta`.
  Done: dragging repaints; collaborators see the same `asOf`; "Latest" clears it.

**Acceptance:** drag re-queries + repaints at the selected commit; `asOf` shared
via Yorkie; `pnpm verify:fast`.

---

## LH-6 — Object-storage backends (S3 / GCS / Azure / MinIO)  ·  depends on: LH-0

**Goal:** mint DuckDB secrets for each storage backend. Shared with File Import FI-4.
**Primary files:** `packages/backend/src/lakehouse/duckdb.service.ts` (secret minting).

- [ ] **S3 + S3-compatible (MinIO/R2).** Scope: `CREATE SECRET (TYPE s3)` from
  decrypted creds; custom endpoint + path-style for compatibles. Done: reads from MinIO.
- [ ] **Azure Blob / ADLS.** Scope: `azure` extension + Azure secret. Done: reads from Azurite.
- [ ] **GCS (S3-interop / HMAC).** Scope: HMAC-key secret via httpfs. Done: reads a GCS-interop fixture.

**Acceptance:** the same fixture reads from each backend (verified by LH-8 parity
suite); `pnpm verify:fast`.

---

## LH-7 — Catalog/table browser + polish  ·  depends on: LH-4

**Goal:** pick a table from a list instead of typing a metadata URI.
**Primary files:** `packages/frontend/src/components/lakehouse-selector.tsx`,
`lakehouse-view.tsx`.

- [ ] **Table browser.** Scope: flat list + namespace navigation from
  `GET /:id/tables`; select to set `lakehouseRef`. Done: pick a table, tab loads it.
- [ ] **Connection-test UX + states.** Scope: surface test result, loading,
  unreachable/credential errors. Done: clear messages for bad creds / unreachable storage.

**Acceptance:** select a catalog table end-to-end; clear errors; `pnpm verify:fast`;
smoke in `pnpm dev`.

---

## LH-8 — Test strategy (emulators + connector-parity)  ·  depends on: LH-1

**Goal:** verify many connectors with $0 local CI.
Detail: design [§8](../../design/sheets/lakehouse-connected-sheet.md#8-test-strategy).
**Primary files:** root `docker-compose.yml`, `.github/workflows/ci.yml`,
`packages/backend/test/lakehouse-*.e2e-spec.ts`, committed fixtures.

- [ ] **Emulator services + fixture seeding.** Scope: MinIO + Azurite in
  docker-compose; seed committed Iceberg/Delta fixtures at test setup. Done: emulators reachable in CI.
- [ ] **Parameterized connector-parity suite.** Scope: one suite over
  `[minio-s3, azurite-azure, gcs-interop, local-fs]` asserting secret mint →
  list → read N rows → history length → `asOf(version K)`. Done: green for all backends.
- [ ] **CI gate + wiring.** Scope: `RUN_LAKEHOUSE_INTEGRATION_TESTS` gate; run
  per PR like the existing Postgres/Yorkie services. Done: CI runs the suite on PRs.
- [ ] **(optional) R2 free-tier smoke.** Scope: scheduled/manual job, repo
  secrets, never fork PRs. Done: real S3-compatible read passes off the hot path.

**Acceptance:** parity green across all local backends; CI runs gated suites per PR.

---

## LH-9 — Hudi via Apache XTable (later)  ·  depends on: LH-5

**Goal:** decide a best-effort Hudi path.
- [ ] **Evaluate Apache XTable** (Hudi → Iceberg/Delta metadata translation) and
  a Trino-gateway alternative; record the decision (+ demo if pursued) in the design doc.

**Acceptance:** decision documented with rationale.

---

## Cross-cutting

- [ ] `docs/design/README.md` Sheets section updated (done on ideation branch)
- [ ] Lessons in paired `20260625-sheets-lakehouse-connector-lessons.md`
- [ ] After all merged: `pnpm tasks:archive && pnpm tasks:index`

## Review

(filled in at completion)
