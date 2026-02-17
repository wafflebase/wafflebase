---
title: datasource
target-version: 0.1.0
---

# Data Sources

## Summary

Data Sources allow users to connect external PostgreSQL databases to their Wafflebase documents. Users can write SQL queries against these connections and display the results in read-only spreadsheet tabs alongside regular editable sheet tabs. This is powered by a multi-tab document structure, a backend module for managing encrypted connections, and a `ReadOnlyStore` in the sheet engine.

## Goals / Non-Goals

### Goals

- Let users connect to external PostgreSQL databases from within Wafflebase
- Provide a SQL editor for running SELECT queries with results shown in a spreadsheet grid
- Keep credentials secure with AES-256-GCM encryption at rest
- Prevent destructive SQL (INSERT, UPDATE, DELETE, DROP, etc.)
- Support multiple tabs per document (sheet tabs + datasource tabs)
- Auto-migrate existing single-sheet documents to the new multi-tab format

### Non-Goals

- Support for databases other than PostgreSQL (MySQL, SQLite, etc.)
- Writing back to external databases
- Scheduled/automatic query refresh
- Sharing datasource connections between users
- Query parameterization or variables

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Frontend                                               │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  TabBar  │  │ DataSource   │  │ DataSourceView    │  │
│  │          │  │ Selector     │  │  - SQL editor     │  │
│  │ Sheet│DS │  │              │  │  - Execute button │  │
│  └──────────┘  └──────────────┘  │  - Results grid   │  │
│                                  └─────────┬─────────┘  │
│                                            │            │
│  ┌──────────────────┐  ┌──────────────────┐│            │
│  │ DataSourceDialog │  │ ReadOnlyStore    ││            │
│  │ (create/edit)    │  │ (sheet engine)   ││            │
│  └──────────────────┘  └──────────────────┘│            │
└────────────────────────────────────┬───────┴────────────┘
                                     │ REST API          
┌────────────────────────────────────┴────────────────────┐
│  Backend                                                │
│  ┌─────────────────────────────────────────────────────┐│
│  │ DataSourceModule                                    ││
│  │  ┌────────────┐ ┌──────────────┐ ┌────────────────┐ ││
│  │  │ Controller │ │ Service      │ │ SQL Validator  │ ││
│  │  │ (REST API) │ │ (pg Client)  │ │                │ ││
│  │  └────────────┘ └──────────────┘ └────────────────┘ ││
│  │  ┌────────────┐                                     ││
│  │  │ Crypto     │                                     ││
│  │  │ (AES-256)  │                                     ││
│  │  └────────────┘                                     ││
│  └─────────────────────────────────────────────────────┘│
│                         │ Prisma                        │
│  ┌──────────────────────┴──────────────────────────────┐│
│  │ PostgreSQL (DataSource table)                       ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

## Proposal Details

### 1. Multi-Tab Document Structure

The Yorkie document was restructured from a flat `Worksheet` to a `SpreadsheetDocument` with multiple tabs:

```typescript
type TabType = "sheet" | "datasource";

type TabMeta = {
  id: string;
  name: string;
  type: TabType;
  datasourceId?: string;  // datasource tabs only
  query?: string;         // saved SQL query
};

type SpreadsheetDocument = {
  tabs: { [id: string]: TabMeta };
  tabOrder: string[];
  sheets: { [tabId: string]: Worksheet };
};
```

- **Sheet tabs** store data in `sheets[tabId]` (the existing `Worksheet` structure).
- **Datasource tabs** store only metadata (`datasourceId`, `query`) in `tabs[tabId]`. Query results are ephemeral and loaded into a `ReadOnlyStore` on execution.

**Auto-migration**: On document load, if the old flat format is detected (has `sheet` but no `tabs`), it is automatically migrated to the new structure in a single Yorkie update. See `migrateDocument()` in `document-detail.tsx`.

### 2. Backend DataSource Module

Located at `packages/backend/src/datasource/`.

#### Database Model

```prisma
model DataSource {
  id         String   @id @default(uuid())
  name       String
  host       String
  port       Int      @default(5432)
  database   String
  username   String
  password   String              // AES-256-GCM encrypted
  sslEnabled Boolean  @default(false)
  authorID   Int
  author     User     @relation(fields: [authorID], references: [id])
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
```

#### API Endpoints

All endpoints require JWT authentication (`JwtAuthGuard`).

| Method | Path | Description |
|--------|------|-------------|
| POST | `/datasources` | Create a new datasource |
| GET | `/datasources` | List user's datasources (passwords masked) |
| GET | `/datasources/:id` | Get single datasource |
| PATCH | `/datasources/:id` | Update datasource fields |
| DELETE | `/datasources/:id` | Delete datasource |
| POST | `/datasources/:id/test` | Test connection (SELECT 1) |
| POST | `/datasources/:id/query` | Execute a SQL query |

#### Access Control

Every operation verifies `ds.authorID === userId`. Users can only access their own datasources.

#### Password Encryption

Passwords are encrypted at rest using AES-256-GCM (`crypto.util.ts`):
- Key: `DATASOURCE_ENCRYPTION_KEY` environment variable (64-char hex = 32 bytes)
- Storage format: `iv:authTag:ciphertext` (all base64-encoded)
- Decrypted only when creating a pg `Client` connection

#### SQL Validation

The `sql-validator.ts` module ensures only read operations are allowed:
- Only `SELECT` and `WITH` (CTEs) statements are permitted
- Forbidden keywords: `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`, `TRUNCATE`, `GRANT`, `REVOKE`, `EXEC`, `EXECUTE`
- Multiple statements (`;` separated) are rejected
- SQL comments are stripped before validation

#### Query Execution

- Queries are wrapped: `SELECT * FROM (<user_query>) AS _q LIMIT 10001`
- Statement timeout: 30 seconds
- Connection timeout: 10 seconds
- Max rows: 10,000 (results marked as `truncated` if exceeded)
- Response includes column metadata, rows, row count, truncation flag, and execution time in ms

### 3. ReadOnlyStore (Sheet Engine)

`packages/sheet/src/store/readonly.ts` implements the `Store` interface for displaying query results:

- `loadQueryResults(columns, rows)` populates the grid:
  - Row 1: column headers with bold styling
  - Row 2+: data rows (null/undefined values skipped)
- All write operations (`set`, `delete`, `shiftCells`, etc.) are no-ops
- Read operations (`get`, `getGrid`, `findEdge`) work normally for rendering
- No undo/redo support

### 4. Frontend Components

| Component | File | Purpose |
|-----------|------|---------|
| `TabBar` | `components/tab-bar.tsx` | Tab strip at bottom of spreadsheet. Shows sheet/datasource icons, supports rename (double-click), delete (context menu), and add (+) |
| `DataSourceView` | `app/spreadsheet/datasource-view.tsx` | SQL editor textarea + Execute button + results grid. Ctrl/Cmd+Enter shortcut. Saves query to Yorkie on execution |
| `DataSourceSelector` | `components/datasource-selector.tsx` | Dialog to pick an existing datasource or create a new one when adding a datasource tab |
| `DataSourceDialog` | `components/datasource-dialog.tsx` | Form for creating a new datasource with connection test |
| `DataSourceList` | `app/datasources/datasource-list.tsx` | Management page with TanStack Table for all user datasources |
| `DataSourceEditDialog` | `app/datasources/datasource-edit-dialog.tsx` | Edit existing datasource properties |

### 5. User Workflow

1. **Create datasource**: Navigate to `/datasources` → click "New DataSource" → fill connection form → optionally test → save
2. **Add datasource tab**: In a document, click "+" on the tab bar → select "DataSource" → pick from existing datasources
3. **Run query**: Write SQL in the editor → click Execute (or Ctrl/Cmd+Enter) → results appear in the grid below
4. **Query persistence**: The SQL query is saved to the Yorkie document, so collaborators see the same query

## Current Limitations

These are known gaps in the current implementation that represent opportunities for future work:

1. **PostgreSQL only** — No support for MySQL, SQLite, BigQuery, or other databases.
2. **Read-only results** — Query results cannot be edited, sorted, or filtered in the grid.
3. **No auto-refresh** — Queries must be manually re-executed to see updated data.
4. **No query history** — Previous queries are not saved; only the latest query persists.
5. **Single-user datasources** — Connections are private to the creator; collaborators on a document cannot use a datasource tab unless they own the connection (they see the query but cannot execute it).
6. **No connection pooling** — Each query execution creates and destroys a pg Client connection.
7. **No schema browser** — Users must know table/column names; there is no database schema explorer.
8. **Basic SQL editor** — Plain textarea without syntax highlighting, autocomplete, or formatting.
9. **No column type mapping** — All values are displayed as strings regardless of the PostgreSQL data type.
10. **Partial backend test coverage** — Unit tests now cover SQL validation and core `DataSourceService` flows, and controller-level e2e tests cover datasource/share-link routes with mocked services. Database-backed integration tests are still missing.

## Next Steps

### Short-term (polish the current feature)

- **Expand backend tests**: Add database-backed integration/e2e tests (Prisma + Postgres) for permission boundaries, encryption/decryption paths, and query failure edge cases.
- **Schema browser**: Add an endpoint to list tables and columns (`information_schema.tables/columns`) and display them in a sidebar panel within `DataSourceView`.
- **SQL editor upgrade**: Integrate a code editor (e.g., CodeMirror) with SQL syntax highlighting, basic autocomplete, and multi-line support.
- **Query history**: Store recent queries per tab so users can recall previous queries.
- **Connection pooling**: Reuse connections or use a pool to reduce latency on repeated queries.

### Medium-term (expand capabilities)

- **Shared datasources**: Allow document collaborators to execute queries using the datasource owner's connection (with explicit permission).
- **Column type awareness**: Map PostgreSQL data types to appropriate cell formats (numbers, dates, booleans) instead of treating everything as strings.
- **Sortable/filterable results**: Add column sorting and basic filtering on query results in the grid.
- **Auto-refresh**: Optional periodic re-execution of queries (with configurable interval).
- **More database types**: Add MySQL, SQLite, and other connectors behind the same `DataSource` abstraction.

### Long-term (deeper integration)

- **Datasource-to-sheet references**: Allow formulas in regular sheet tabs to reference values from datasource query results (e.g., `=DS1!A2`).
- **Parameterized queries**: Support query variables that reference cell values, enabling dynamic dashboards.
- **Write-back**: Allow editing query results and writing changes back to the source database (with safeguards).
- **Visualization**: Chart/graph support built on top of datasource query results.

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| SQL injection via query wrapping | User query is wrapped in a subquery (`SELECT * FROM (...) AS _q LIMIT N`). The SQL validator rejects non-SELECT statements. However, advanced attacks (e.g., function calls with side effects) may still be possible. Consider using a read-only database role. |
| Credential exposure | Passwords encrypted at rest with AES-256-GCM. Masked in API responses. Encryption key must be kept secure via environment variable. |
| Resource exhaustion from large queries | 30s timeout + 10,000 row limit + per-query connection (no shared resources). Consider adding rate limiting per user. |
| Stale connections to unreachable hosts | 10s connection timeout. Connections are cleaned up in `finally` blocks. |
| Migration data loss | Migration is additive (wraps existing data in new structure, then deletes old keys). Tested with the auto-migration logic in `migrateDocument()`. |
