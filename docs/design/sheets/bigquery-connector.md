---
title: bigquery-connector
target-version: 0.5.0
---

# BigQuery Connector

> Part of the External Data Sources initiative — see the [epic index](../../tasks/active/20260625-sheets-external-data-sources-todo.md).
> Extends the existing [PostgreSQL datasource](datasource.md) pattern.

## Summary

Connect a Wafflebase document to **Google BigQuery** as a read-only datasource:
write GoogleSQL `SELECT` queries and render results in a read-only tab. It
reuses the existing datasource read-only spine — encrypted credentials, the
SELECT-only validator, the `{ columns, rows, … }` response shape, and the
`ReadOnlyStore` — and swaps the `pg` client for the **native
`@google-cloud/bigquery`** client. The one BigQuery-specific addition is **cost
guardrails**, because BigQuery bills by bytes scanned.

## Goals / Non-Goals

### Goals

- Read-only BigQuery query results in a sheet tab, reusing the datasource spine.
- Service-account authentication with the key **encrypted at rest** (reuse
  `crypto.util.ts`).
- **Cost guardrails**: dry-run byte/cost estimate, a `maximumBytesBilled`
  ceiling, and a pre-run warning.
- Dataset / table / column schema browser.

### Non-Goals

- Writing back to BigQuery.
- Other warehouses (Snowflake, Redshift) — separate connectors later.
- BI Engine / streaming / continuous queries.

## Architecture Overview

This extends the existing datasource family:

```
  Frontend (reuses datasource view shell)
   BigQueryDialog · SQL editor · cost-estimate banner · results grid
        │ REST API
   Backend BigQueryModule
   ┌──────────────┬────────────────┬─────────────────────┐
   │ Controller   │ Service        │ Crypto (AES-256)    │
   │ (REST)       │ (@google-cloud │ (reuse crypto.util) │
   │              │  /bigquery)    │                     │
   └──────────────┴───────┬────────┴─────────────────────┘
        Prisma            │ service-account key (decrypted per request)
   BigQuerySource row     ▼
                     Google BigQuery  ── dry-run estimate + maximumBytesBilled
```

Compared to the existing PostgreSQL datasource, only the **driver** (pg →
`@google-cloud/bigquery`), the **auth** (password → service-account JSON), and
the **cost guardrails** differ; everything else is shared.

## Proposal Details

### 1. Connection model (Prisma)

```prisma
model BigQuerySource {
  id          String   @id @default(uuid())
  name        String
  projectId   String
  dataset     String?  // default dataset (optional)
  location    String?  // e.g. "US", "asia-northeast3"
  // service-account JSON key, AES-256-GCM encrypted (reuse crypto.util.ts)
  credentials String
  maximumBytesBilled BigInt? // per-connection ceiling (matches the BigQuery API name; optional)
  authorID    Int
  author      User      @relation(fields: [authorID], references: [id])
  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}
```

### 2. Query execution (native client)

- `@google-cloud/bigquery` client, authenticated from the decrypted
  service-account key.
- Reuse the SELECT/WITH-only validator (GoogleSQL dialect) and the 10,000-row
  cap; map result schema + rows to the shared
  `{ columns: [{name, dataTypeID}], rows, rowCount, truncated, executionTime }`
  shape → `ReadOnlyStore` + `toCell` render unchanged (BigQuery STRUCT/ARRAY →
  JSON-string cells, like nested JSON).

### 3. Cost guardrails (the BigQuery-specific part)

BigQuery charges by **bytes scanned**, and a `LIMIT` does **not** reduce the
scan (full scan unless the table is partitioned/clustered). So:

- **Dry run** (`dryRun: true`) before execution → returns
  `totalBytesProcessed`; surface an estimated bytes/cost banner.
- **`maximumBytesBilled`** ceiling (per-connection + per-query) → BigQuery hard-
  fails a query that would exceed it, so a runaway scan cannot bill.
- **Warning UI** when the estimate exceeds a threshold; require confirmation.

### 4. Schema browser

List datasets → tables → columns (BigQuery metadata API) in a sidebar, so users
don't have to memorize names; click to insert into the editor.

### 5. Frontend

Reuse the datasource view shell: a `BigQueryDialog` (project/dataset + key
upload + test), a SQL editor view, and a **cost-estimate banner** above the
Run button.

## Test Strategy

- **Unit** (no network): validator, response-shape mapping, credential masking,
  cost-threshold logic — with the BigQuery client mocked.
- **Integration** (gated, e.g. `RUN_BIGQUERY_INTEGRATION_TESTS`): against a real
  BigQuery project using the **free tier** (1 TB/month query, 10 GB storage),
  scoped to a tiny fixture dataset; service-account key via repo secrets, never
  on fork PRs. Dry-run/`maximumBytesBilled` assertions covered here.
- There is no first-party local BigQuery emulator; integration tests therefore
  use the free tier rather than an emulator.

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| **Runaway query cost** (bytes scanned) | Dry-run estimate + `maximumBytesBilled` ceiling + warning UI; default a conservative per-connection cap. |
| Service-account key exposure | AES-256-GCM at rest (`crypto.util.ts`); masked in API responses; decrypt only per request. |
| Over-broad key permissions | Document least-privilege (BigQuery Data Viewer + Job User); never request write scopes. |
| No local emulator for CI | Gate integration tests; use the free tier with a tiny fixture; unit tests mock the client. |
| Result size / cost on large tables | 10k-row cap + dry-run; encourage partition/cluster-aware queries in docs. |

## References

- [External Data Sources epic index](../../tasks/active/20260625-sheets-external-data-sources-todo.md) — umbrella + future roadmap
- [datasource.md](datasource.md) — read-only spine this extends
- `@google-cloud/bigquery` Node client: <https://cloud.google.com/nodejs/docs/reference/bigquery/latest>
- BigQuery dry-run / `maximumBytesBilled`: <https://cloud.google.com/bigquery/docs/best-practices-costs>
