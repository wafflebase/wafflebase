# TODO — External Data Sources (Epic index)

Umbrella for the three "Connected Sheets over the open stack" roadmaps. This
file is the **map**: strategy, master dependency graph, and links to each
roadmap's design doc (architecture) and task doc (execution).

Issue bodies (paste-ready): [20260625-sheets-external-data-sources-issues.md](20260625-sheets-external-data-sources-issues.md)

**Strategy:** one embedded **DuckDB** engine (in the NestJS backend) + the
existing datasource read-only spine unlock a family of sources — the open-stack
equivalent of Connected Sheets. Two ingestion modes apply across all:
**Connect** (live read-only via `ReadOnlyStore`) vs **Import** (materialize to
editable cells).

## Roadmaps → docs

| # | Roadmap | Design doc (roadmap issue links) | Task doc (subissues link) |
|---|---------|----------------------------------|----------------------------|
| ① | File Import | [file-import.md](../../design/sheets/file-import.md) | [20260625-sheets-file-import-todo.md](20260625-sheets-file-import-todo.md) |
| ② | Lakehouse connector | [lakehouse-connected-sheet.md](../../design/sheets/lakehouse-connected-sheet.md) | [20260625-sheets-lakehouse-connector-todo.md](20260625-sheets-lakehouse-connector-todo.md) |
| ③ | BigQuery connector | [bigquery-connector.md](../../design/sheets/bigquery-connector.md) | [20260625-sheets-bigquery-connector-todo.md](20260625-sheets-bigquery-connector-todo.md) |
| ④ | MySQL connector | [mysql-connector.md](../../design/sheets/mysql-connector.md) | [20260625-sheets-mysql-connector-todo.md](20260625-sheets-mysql-connector-todo.md) |

## Master dependency graph (across roadmaps)

```
  ① File Import
     FI-1 · CSV (client-side) ── independent, ship first ───────────────►
     FI-2 · Parquet ┐
     FI-3 · JSON    ┘┄(large path)┄┐
     FI-4 · Connect ──────────────┐│
     FI-5 · large-file routing ◄─FI-4
                                  ││
  ② Lakehouse                     ││
     LH-0 · DuckDB engine ◄───────┴┴── (FI large/remote depend on LH-0)
      ├─► LH-1 ─► {LH-2, LH-3, LH-4 ─► LH-7, LH-5 ─► LH-9, LH-8}
      └─► LH-6 · storage backends ──► shared with FI-4

  ③ BigQuery  (independent — single issue, datasource family)
  ④ MySQL     (independent — single issue, datasource family)

  Legend: ─► hard dep   ┄► soft dep (only the large/remote file path)
```

Key facts:
- **LH-0 (DuckDB engine) is the one cross-roadmap unblocker** — File Import's
  large/remote paths (FI-2/3/4) depend on it; CSV (FI-1) does not.
- **LH-6 (storage backends)** is shared by Lakehouse and File Import FI-4.
- **BigQuery (③) is fully independent** and can run in parallel from day one.

## Suggested start order

1. Parallel: `FI-1` (no deps) ‖ `LH-0` (engine) ‖ `BQ-1→BQ-2` (independent).
2. `LH-1 → LH-3 → LH-5` (lakehouse + time travel headline).
3. `FI-2/FI-3` then `FI-4/FI-5`; `LH-2/4/6/7/8`.
4. `BQ-3` (cost guardrails) early once BQ-2 lands.
5. Later: `LH-9` (Hudi), `BQ-6` (refresh/cache).

## Future / beyond these roadmaps

The same engine + datasource spine unlock more sources (from the original
vision; not yet scoped into roadmaps):

- **SQLite** — native driver, extends the datasource pattern (like the MySQL roadmap ④).
- **More warehouses — Snowflake / Redshift / ClickHouse** — datasource family like BigQuery; per-warehouse auth/driver.
- **Catalog integrations — Unity Catalog / Glue / Polaris / Nessie** — extends Lakehouse LH-4 into a governed table browser.
- **SaaS imports — Google Sheets / Airtable / Notion** — API integrations.
- **DuckLake** — DuckDB's SQL-based lakehouse catalog format (forward-looking).
- **Export / write-back / scheduled refresh** — reverse direction: sheet → Parquet/CSV/Iceberg; periodic re-materialization.

## Cross-cutting

- [ ] Design docs landed on `docs/ideation` branch.
- [ ] Maintainer files 3 roadmap issues + subissues from the issue-bodies doc.
- [ ] Per roadmap completion: lessons in the paired `*-lessons.md`, then
      `pnpm tasks:archive && pnpm tasks:index`.

## Review

(filled in at completion)
