---
title: mysql-connector
target-version: 0.5.0
---

# MySQL Connector

> Part of the External Data Sources initiative — see the [epic index](../../tasks/active/20260625-sheets-external-data-sources-todo.md).
> Extends the existing [PostgreSQL datasource](datasource.md) to MySQL.

## Summary

Connect a Wafflebase document to **MySQL / MariaDB** as a read-only datasource —
the same experience as the existing PostgreSQL datasource, with a different
driver. The top-level `README.md` already promises this: *"Data Source
integration (coming soon) — Connect directly to PostgreSQL/MySQL to query live
data."*

It reuses the entire datasource read-only spine — encrypted credentials, the
SELECT-only validator, the `{ columns, rows, … }` response shape, and the
`ReadOnlyStore` — and adds an `engine` discriminator on the connection plus the
native `mysql2` client. This is the **smallest** of the external-data
connectors: no new engine, no cost guardrails, no time travel.

## Goals / Non-Goals

### Goals

- Read-only MySQL / MariaDB query results in a datasource tab, reusing the
  datasource spine end-to-end.
- An `engine` field on the connection (`postgres` | `mysql`) with the right
  default port (5432 vs 3306) and driver dispatch.
- Reuse the SELECT/WITH-only validator, 10,000-row cap, timeouts, and
  AES-256-GCM credential encryption.
- Schema browser parity (`information_schema` tables/columns).

### Non-Goals

- Write-back to MySQL.
- Databases beyond MySQL / MariaDB (SQLite and warehouses are separate tracks).
- Any change to the lakehouse / file-import DuckDB engine — unrelated.

## Architecture Overview

Same datasource family as PostgreSQL; the only differences are the **driver**
(`pg` → `mysql2`) and the **default port** behind an `engine` discriminator.

```
  Frontend (existing datasource view + dialog)
   DataSourceDialog (engine: postgres | mysql) · SQL editor · results grid
        │ REST API (existing datasource endpoints)
   Backend DataSourceModule
   ┌──────────────┬──────────────────────────────┬─────────────────────┐
   │ Controller   │ Service (driver dispatch)    │ Crypto (AES-256)    │
   │ (REST)       │  ├─ pg     (postgres)        │ (reuse crypto.util) │
   │              │  └─ mysql2 (mysql)           │                     │
   └──────────────┴───────────────┬──────────────┴─────────────────────┘
        Prisma                    │ decrypted creds
   DataSource row (engine)        ▼
                              PostgreSQL  /  MySQL · MariaDB
```

## Proposal Details

### 1. Connection model (Prisma)

Extend the existing `DataSource` model with an `engine` discriminator rather than
a new table:

```prisma
model DataSource {
  // ... existing fields (host, port, database, username, password, sslEnabled) ...
  engine String @default("postgres") // "postgres" | "mysql"
}
```

- Default port resolves by engine when unset (5432 / 3306).
- Existing rows default to `postgres` (backward compatible; no data migration of
  values needed beyond adding the column).

### 2. Query execution (native `mysql2`)

- The service dispatches on `engine`: `pg.Client` for postgres, `mysql2` for
  mysql. Add `mysql2` to `packages/backend` dependencies.
- Reuse the SELECT/WITH-only validator and the `LIMIT 10001` wrap + 10,000-row
  truncation flag. (MySQL dialect uses backtick identifiers, but SELECT/WITH
  detection and the forbidden-keyword list are unaffected.)
- Map `mysql2` field metadata + rows to the shared
  `{ columns: [{name, dataTypeID}], rows, rowCount, truncated, executionTime }`
  shape → `ReadOnlyStore` + `toCell` render unchanged.
- Date/time handling: return DATE / DATETIME / TIMESTAMP as raw strings (set
  `dateStrings: true` on the mysql2 connection) to avoid the timezone shift the
  Postgres path also guards against (commit 51c01826).

### 3. Frontend

The existing `DataSourceDialog` / datasource view gain an **engine selector**
(PostgreSQL / MySQL); the port field defaults by engine. Everything else (SQL
editor, results grid, tab) is reused unchanged.

### 4. Schema browser

`information_schema.tables` / `information_schema.columns` exist in MySQL too, so
the schema browser (a datasource next-step) works for both engines with the same
queries.

## Test Strategy

- **Unit** (no network): engine dispatch, validator, response-shape mapping,
  type/date coercion — with the client mocked.
- **Integration** (gated): a **MySQL service in docker-compose** alongside the
  existing Postgres service; run the datasource integration suite against both
  engines behind `RUN_DB_INTEGRATION_TESTS`. MySQL is free and runs fully local
  (no cloud, no cost) — the simplest connector to CI.

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Dialect differences (identifiers, functions) | Validator only gates statement type + forbidden keywords; the `LIMIT` wrap is valid MySQL. Document dialect notes. |
| Auth plugin (`caching_sha2_password` on MySQL 8) | `mysql2` supports it natively; document required server config / TLS. |
| Timezone shift on DATE/DATETIME | `dateStrings: true` returns raw strings (mirrors the Postgres raw-text approach). |
| Charset / encoding (utf8mb4) | Default connection charset utf8mb4; document. |
| Credential exposure | Reuse AES-256-GCM (`crypto.util.ts`); masked in API responses. |

## References

- [datasource.md](datasource.md) — the PostgreSQL datasource this extends
- [External Data Sources epic index](../../tasks/active/20260625-sheets-external-data-sources-todo.md)
- `mysql2` Node client: <https://github.com/sidorares/node-mysql2>
