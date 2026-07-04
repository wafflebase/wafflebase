---
title: lakehouse-connected-sheet
target-version: 0.5.0
---

# Lakehouse Connected Sheet

## Summary

A **Lakehouse Connected Sheet** lets users point a Wafflebase document at an
**open table format** (OTF) — **Apache Iceberg** or **Delta Lake** — sitting in
object storage (S3, GCS, Azure Blob, MinIO), and browse it inside a read-only
spreadsheet tab. Because these formats keep a metadata layer of immutable
**snapshots / versions**, the tab adds a **time-travel slider**: dragging the
slider re-reads the table *as of* a past commit and repaints the grid, turning
"observe how this table changed over time" from a manual SQL chore (re-running
queries with different snapshot predicates) into a single draggable timeline.

This builds directly on the existing
[Data Sources](datasource.md) feature. It reuses the same read-only
spreadsheet spine — encrypted-credential storage, a SELECT-only validator, the
`{ columns, rows, … }` query response shape, and the `ReadOnlyStore` in the
sheet engine — and swaps the PostgreSQL `pg` client for an **embedded DuckDB**
engine (`@duckdb/node-api`) that reads OTFs natively.

## Goals / Non-Goals

### Goals

- Connect a Wafflebase document to an Iceberg or Delta Lake table in object
  storage and render it in a read-only tab.
- Support the common object-storage backends: Amazon S3, S3-compatible
  (MinIO, Cloudflare R2, …), Google Cloud Storage, and Azure Blob / ADLS.
- Provide a **time-travel slider** over the table's commit history (snapshot
  id for Iceberg, version number for Delta) that re-queries the table *as of*
  the selected commit.
- Keep object-storage credentials encrypted at rest, reusing the datasource
  AES-256-GCM scheme.
- Reuse the existing read-only rendering path (`ReadOnlyStore`, `toCell`) and
  multi-tab document structure unchanged.
- Persist the chosen table reference and time-travel point to the Yorkie
  document so collaborators see the same view.

### Non-Goals

- **Apache Hudi** support (deferred — see [Technical Verification](#5-technical-verification)).
- Writing back to lakehouse tables (read-only, like datasource tabs).
- A general SQL-over-lakehouse editor in v1 (queries are table scans with an
  optional `asOf`; ad-hoc SQL is a later phase).
- Sub-commit time travel (granularity is per-commit, not arbitrary instants).
- Running DuckDB in the browser (DuckDB-Wasm) — the engine runs in the backend
  (see the pure-JS note in Technical Verification for the future browser path).
- A hosted query API (MotherDuck) — the engine is embedded in our backend.

## Architecture Overview

The design intentionally mirrors [`datasource.md`](datasource.md); only the
shaded boxes are new.

```
┌────────────────────────────────────────────────────────────┐
│  Frontend                                                  │
│  ┌──────────┐  ┌──────────────┐  ┌─────────────────────┐   │
│  │  TabBar  │  │ Lakehouse    │  │ LakehouseView       │   │
│  │ Sheet│DS │  │ Selector     │  │  - table picker     │   │
│  │   │LH    │  │              │  │  - TimeTravelSlider │   │ ← new
│  └──────────┘  └──────────────┘  │  - results grid     │   │
│                                  └─────────┬───────────┘   │
│  ┌──────────────────┐  ┌──────────────────┐│               │
│  │ LakehouseDialog  │  │ ReadOnlyStore    ││ (reused)      │
│  │ (create/edit)    │  │ (sheet engine)   ││               │
│  └──────────────────┘  └──────────────────┘│               │
└─────────────────────────────────────┬──────┴───────────────┘
                                      │ REST API
┌─────────────────────────────────────┴──────────────────────┐
│  Backend (NestJS)                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ LakehouseModule                                     │   │
│  │  ┌────────────┐ ┌────────────────┐ ┌─────────────┐  │   │
│  │  │ Controller │ │ Service        │ │ SQL/scan    │  │   │
│  │  │ (REST API) │ │ (DuckDB Neo)   │ │ validator   │  │   │
│  │  └────────────┘ └───────┬────────┘ └─────────────┘  │   │
│  │  ┌────────────┐         │ INSTALL/LOAD iceberg,     │   │
│  │  │ Crypto     │         │ delta, httpfs, azure      │   │
│  │  │ (AES-256)  │         │ CREATE SECRET (creds)     │   │
│  │  └────────────┘         ▼                           │   │
│  └─────────────────┬───────────────────────────────────┘   │
│        Prisma      │                  embedded DuckDB      │
│  ┌─────────────────┴────────┐   (in-process, native dep)   │
│  │ PostgreSQL               │              │               │
│  │ (LakehouseSource rows)   │              ▼               │
│  └──────────────────────────┘   Object storage (S3/GCS/    │
│                                  Azure/MinIO) — Iceberg /  │
│                                  Delta metadata + parquet  │
└────────────────────────────────────────────────────────────┘
```

**Key point on deployment:** DuckDB is **embedded** in the NestJS process via
`@duckdb/node-api` — a native npm dependency that ships prebuilt binaries, just
like the `pg` client is a dependency today. There is **no separate DuckDB
service and no external API to call.** The backend reads object storage
directly using the stored, decrypted credentials, keeping the trust boundary
identical to the current PostgreSQL datasource path.

## Proposal Details

### 1. Multi-Tab Document Structure

Reuse the existing `SpreadsheetDocument` / `TabMeta` structure (canonical in
[`collaboration.md`](collaboration.md)). Add a third tab type and two
lakehouse-specific fields:

```typescript
type TabType = "sheet" | "datasource" | "lakehouse";

type TabMeta = {
  id: string;
  name: string;
  type: TabType;
  // datasource tabs
  datasourceId?: string;
  query?: string;
  // lakehouse tabs (new)
  lakehouseSourceId?: string;       // FK to the connection
  lakehouseRef?: LakehouseTableRef; // which table (catalog/namespace/table or metadata URI)
  asOf?: TimeTravelPoint;           // selected commit; undefined = latest
};

type LakehouseTableRef = {
  // direct-metadata mode (no catalog):
  metadataUri?: string;             // e.g. s3://bucket/db/table  (Delta) or .../metadata.json (Iceberg)
  // catalog mode:
  namespace?: string[];
  table?: string;
};

type TimeTravelPoint =
  | { kind: "version"; version: number }      // integer; interpreted per the source format (Delta version / Iceberg sequence)
  | { kind: "snapshot"; snapshotId: string }  // Iceberg snapshot id
  | { kind: "timestamp"; iso: string };       // point-in-time
```

A bare integer is ambiguous on its own, but `asOf` is always resolved in the
context of the connection's `format` (Delta vs Iceberg), so `kind: "version"`
needs no further split; Iceberg's stable snapshot id is the `"snapshot"` variant.

Lakehouse tabs store **only metadata** in `tabs[tabId]`; the rows are ephemeral
and loaded into a `ReadOnlyStore` on read, exactly like datasource tabs.
Persisting `lakehouseRef` + `asOf` to Yorkie means collaborators open the same
table at the same point in time. Because these are new Yorkie-persisted
`TabMeta` fields, `worksheet-shape-migration.ts` must tolerate old documents
that lack them (treat missing `lakehouseSourceId`/`lakehouseRef`/`asOf` as
`undefined` — no backfill needed); cover this in the migration's tests.

### 2. Connection Model (Prisma)

Add a `LakehouseSource` model alongside `DataSource`
(`packages/backend/prisma/schema.prisma`). It keeps the same workspace-scoped
ownership (`workspaceId`, `authorID`) and reuses the AES-256-GCM credential
encryption.

```prisma
model LakehouseSource {
  id            String   @id @default(uuid())
  name          String
  format        String   // "iceberg" | "delta"
  storage       String   // "s3" | "s3-compatible" | "gcs" | "azure" | "local"
  endpoint      String?  // custom endpoint (MinIO/R2/GCS-interop)
  region        String?
  bucket        String?
  basePath      String?  // table root or metadata path
  catalogMode   CatalogMode @default(direct_metadata)
  catalogUri    String?
  // credentials, AES-256-GCM encrypted (one packed JSON blob: accessKey/secretKey/sasToken/oauth).
  // Optional only because the credential blob is written in a second step after
  // the row is created (matching the datasource create→test→save flow); a saved,
  // usable connection always has credentials.
  credentials   String?
  authorID      Int
  author        User      @relation(fields: [authorID], references: [id])
  workspaceId   String
  workspace     Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@unique([workspaceId, name]) // no duplicate connection names within a workspace
}

enum CatalogMode {
  direct_metadata
  rest_catalog
  s3_tables
  unity
}
```

Credentials are encrypted with the existing
`packages/backend/src/datasource/crypto.util.ts` (`DATASOURCE_ENCRYPTION_KEY`),
masked in all API responses, and decrypted only to mint a DuckDB secret.

### 3. Backend Lakehouse Module

Located at `packages/backend/src/lakehouse/`, mirroring the datasource module
layout (service / controller / DTO / validator + reused crypto).

#### DuckDB query service (embedded)

- `LakehouseService` owns a **long-lived** DuckDB instance and a small
  connection pool. **Do not** create a fresh instance per request — DuckDB is
  in-process, so a singleton instance with per-query connections amortizes the
  extension-load cost.
- On first use, `INSTALL` / `LOAD` the `iceberg`, `delta`, and `httpfs` /
  `azure` extensions (auto-downloaded from DuckDB's extension repo, or
  pre-bundled into the backend image for locked-down networks).
- Per query: `CREATE SECRET` from the decrypted credentials (scoped to the
  request), then run a wrapped read:
  - **Iceberg, direct metadata:** `iceberg_scan('s3://…/metadata/….metadata.json')`.
  - **Iceberg, catalog:** `ATTACH` an Iceberg REST catalog / S3 Tables, then
    `SELECT … FROM <ns>.<table>`.
  - **Delta:** `delta_scan('s3://…/table')`.
- Reuse the datasource guardrails: a SELECT/scan-only validator (adapted from
  `sql-validator.ts`), a `LIMIT 10001` wrap with a 10,000-row truncation flag,
  and statement / connection timeouts.

#### Query response shape (identical to datasource)

```typescript
{
  columns: Array<{ name: string; dataTypeID: number }>;
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  executionTime: number;
}
```

Returning the same shape means the frontend API client, `ReadOnlyStore`, and
`toCell` (`packages/sheets/src/store/readonly.ts`) are reused **unchanged**.
DuckDB struct/list/JSON values arrive as objects and are rendered via `toCell`
as JSON strings; timestamps as ISO strings — the same handling shipped in the
`feat/support-json-postgresql` work (commit 51c01826).

#### API Endpoints

All require JWT auth and workspace membership (mirrors datasource access
control).

| Method | Path | Description |
|--------|------|-------------|
| POST | `/workspaces/:wid/lakehouse-sources` | Create a lakehouse connection |
| GET | `/workspaces/:wid/lakehouse-sources` | List (credentials masked) |
| GET | `/lakehouse-sources/:id` | Get one |
| PATCH | `/lakehouse-sources/:id` | Update |
| DELETE | `/lakehouse-sources/:id` | Delete |
| POST | `/lakehouse-sources/:id/test` | Test storage + table reachability |
| GET | `/lakehouse-sources/:id/tables` | List tables (catalog mode) |
| GET | `/lakehouse-sources/:id/history` | Commit timeline for a table (drives the slider) |
| POST | `/lakehouse-sources/:id/read` | Read rows, optional `asOf` |

### 4. Time-Travel Slider (headline feature)

This is the differentiator over a plain datasource tab.

**History endpoint** returns the table's commit timeline:

```typescript
type LakehouseHistory = Array<{
  ref: TimeTravelPoint;     // version or snapshot id
  timestamp: string;        // ISO commit time
  operation?: string;       // e.g. "append", "overwrite", "delete"
  summary?: Record<string, string>; // record/file counts when available
}>;
```

Sourced from:
- **Iceberg** — the `iceberg_snapshots(...)` metadata function.
- **Delta** — the Delta history (`… ('HISTORY')` / version log).

**Read-at-version:** the `/read` endpoint accepts an optional `asOf`
(`TimeTravelPoint`) and emits DuckDB time-travel syntax:
- **Delta:** `delta_scan('…', version => N)` or `TIMESTAMP AS OF`.
- **Iceberg:** snapshot selection on `iceberg_scan` / `… AT (VERSION => …)`.

> The exact per-extension argument names are version-sensitive and confirmed in
> the **Phase 0 spike** (see [Rollout](#7-rollout)) before wiring the slider.

**Frontend `TimeTravelSlider`** sits above the results grid inside a
`LakehouseView` (cloned from `datasource-view.tsx`):
- Discrete stops = commits, labeled with timestamp + operation; the right end
  is "latest".
- Dragging selects a commit, calls `/read` with the new `asOf`, and reloads the
  `ReadOnlyStore` + repaints — the same reload path datasource queries use.
- The selected `asOf` is written to the Yorkie `TabMeta`, so collaborators see
  the same point in time. A "Latest" affordance clears `asOf`.

A `TabBar` "New Lakehouse" entry and a `LakehouseSelector` (cloned from
`datasource-selector.tsx`) create the tab and pick the table.

### 5. Technical Verification

All claims below were verified against current DuckDB / ecosystem docs (June
2026); citations are in [References](#references).

#### Object-storage backends (DuckDB `httpfs` / `azure`)

| Backend | Supported | Mechanism |
|---------|-----------|-----------|
| Amazon S3 | ✅ | `httpfs` + `CREATE SECRET (TYPE s3)` (or `credential_chain`) |
| S3-compatible (MinIO, R2, …) | ✅ | `httpfs` + custom `ENDPOINT` / path-style addressing |
| Google Cloud Storage | ✅ | `httpfs` via GCS S3-interoperability (HMAC keys) |
| Azure Blob / ADLS Gen2 | ✅ | `azure` extension + Azure secret |
| Local filesystem | ✅ | native (dev / on-box tables) |

#### Open table formats

| Format | Read | Time travel | Status |
|--------|------|-------------|--------|
| **Apache Iceberg** | ✅ | ✅ snapshot id / timestamp | **Supported.** DuckDB `iceberg` extension; direct-metadata reads, Iceberg REST Catalogs, and Amazon S3 Tables. Upstream labels parts experimental but core read + snapshot time-travel are functional. |
| **Delta Lake** | ✅ | ✅ `VERSION AS OF` / `TIMESTAMP AS OF` | **Supported.** DuckDB `delta` extension (built on Delta Kernel). Read + time travel graduated from experimental to GA in DuckDB v1.5.2; broad object-store coverage via the DuckDB FileSystem API. |
| **Apache Hudi** | ❌ | — | **Unsupported / deferred.** No native DuckDB reader and no JS/Node reader exist; Hudi reads (incl. time travel) go through JVM query engines (Spark / Flink / Trino). Future path: **Apache XTable** metadata translation (Hudi → Iceberg/Delta) so the existing Iceberg/Delta path picks it up, or a Trino gateway. Tracked as a known gap. |

#### Engine choice & deployment

- **Embedded DuckDB** via `@duckdb/node-api` (the "Neo" client). The older
  `duckdb-node` package is being deprecated (last release on the 1.4.x line; no
  1.5.x), so the Neo client is the correct, Promise-native choice.
- It runs **in-process** in the NestJS backend (native dependency, prebuilt
  binaries) — **not** a separate service and **not** an external API. This
  directly answers the deployment question: DuckDB is *added to the backend*
  and executed there, the same way `pg` is today.
- **MotherDuck** (hosted DuckDB-as-a-service) is a possible "just call an API"
  alternative but is intentionally **not** chosen: embedded keeps object-store
  credentials inside our own backend and avoids a SaaS dependency.

#### Pure-JS alternative (future, not chosen)

`icebird` (built on `hyparquet`) reads Iceberg parquet directly in JS/browser
with no native binary, but supports only a subset of Iceberg features and has
**no** Delta or Hudi reader. `delta-rs` has no first-party Node binding. These
are recorded as a potential **no-native-deps / browser (DuckDB-Wasm or icebird)**
path for a later phase, not the v1 engine.

### 6. Current Limitations

1. **Read-only** — no write-back to lakehouse tables.
2. **Iceberg + Delta only** — Hudi is unsupported (see above).
3. **Per-commit time-travel granularity** — the slider stops at commits, not
   arbitrary instants (timestamp queries resolve to the commit at-or-before).
4. **GCS via interop** — GCS uses S3-interoperability (HMAC keys); native GCS
   auth is not first-class in `httpfs`.
5. **Native binary in the backend image** — `@duckdb/node-api` ships platform
   binaries; the deploy image must match the runtime platform.
6. **Extension auto-download** — `iceberg`/`delta` auto-load from DuckDB's repo
   on first use; locked-down networks must pre-bundle the extensions.
7. **Single-table scans in v1** — no joins / ad-hoc SQL across lakehouse tables
   yet.
8. **No schema browser** for catalog mode beyond a flat table list initially.

### 7. Rollout

Phased, each phase a separate PR with `pnpm verify:fast` green:

- **Phase 0 — Verification spike.** A standalone script proves the DuckDB path
  end-to-end against sample Iceberg and Delta tables in MinIO (read + history +
  `asOf`), and pins exact extension argument names. No product code.
- **Phase 1 — Connection + Iceberg read.** `LakehouseSource` model, module,
  encrypted creds, `test`, and direct-metadata Iceberg read rendered via
  `ReadOnlyStore`.
- **Phase 2 — Delta read** + catalog mode (Iceberg REST / S3 Tables).
- **Phase 3 — Time-travel slider.** History endpoint, `asOf` reads,
  `TimeTravelSlider`, Yorkie persistence.
- **Phase 4 — Catalog/table browser** and polish.
- **Later — Hudi via XTable**, ad-hoc SQL, pure-JS/browser path.

### 8. Test Strategy

The hard part is verifying **many storage connectors** (S3 / Azure / GCS /
MinIO) without paying for cloud or leaking credentials. The plan: local
emulators for CI ($0, deterministic), a free cloud tier for occasional real
fidelity, committed OTF fixtures, and one parameterized connector-parity suite.

#### Free / local object storage (CI default, $0)

| Emulator | Emulates | Notes |
|----------|----------|-------|
| **MinIO** | S3 + any S3-compatible (R2, B2, …) | Already used for image storage in dev (`forcePathStyle`, `localhost:9000`, `minioadmin`); add a docker-compose service. Primary S3 target. |
| **Azurite** | Azure Blob / ADLS | Microsoft's official emulator; docker-compose service for the `azure` connector. |
| **fake-gcs-server** | Google Cloud Storage | For the GCS connector; alternatively exercise GCS's S3-interop (HMAC) path through MinIO. |
| **Local filesystem** | n/a | Cheapest — DuckDB reads files directly; used for unit tests with no network. |

#### Optional real-cloud smoke (free tiers)

For periodic real-fidelity checks (not per-PR): **Cloudflare R2** (10 GB free,
no egress, S3-compatible) is the best fit; **Backblaze B2** (10 GB free,
S3-compatible), **AWS S3** (5 GB/12 mo), and **Azure / GCS** free credit are
alternatives. Opt-in, scheduled or manual, credentials via repo secrets, and
**never run on fork PRs**.

#### Fixtures (sample OTF tables with history)

- Commit **tiny pre-built Iceberg + Delta tables** (metadata + a few small
  parquet files) with **≥3 snapshots/versions** as test fixtures —
  deterministic, no generation step in the hot CI path.
- A documented regeneration script (PyIceberg / Python `deltalake` / DuckDB's
  Delta-write) recreates them when the schema changes.
- Test setup seeds the fixtures into MinIO / Azurite (and local FS).

#### Connector-parity suite (the multi-connector matrix)

One **storage-connector contract** suite, parameterized over a list of backend
configs, runs the *same* assertions against each backend so parity is
guaranteed without duplicated tests:

```
for backend in [ minio-s3, azurite-azure, gcs-interop, local-fs ]:
  - secret minting from encrypted creds succeeds
  - list/reach the fixture table
  - read N rows (matches expected)
  - history length == fixture commit count
  - asOf(version K) returns the historical row set
```

Matrix dimensions: **storage backend × format (Iceberg / Delta) × auth mode**
(S3 key/secret · Azure connection-string/SAS · GCS HMAC).

#### Test layers (mirror existing repo gates)

| Layer | Scope | Gate |
|-------|-------|------|
| **Unit** (no network) | `asOf` syntax builder, scan-only validator, credential masking, `{ columns, rows, … }` mapping; DuckDB over local-FS fixtures | always on (`pnpm verify:fast`) |
| **Integration** | real DuckDB vs MinIO/Azurite containers — read + history + `asOf` | `RUN_LAKEHOUSE_INTEGRATION_TESTS=true` (mirrors `RUN_DB_INTEGRATION_TESTS` / `RUN_YORKIE_INTEGRATION_TESTS`) |
| **CI** | docker-compose adds MinIO + Azurite services (like the Postgres + Yorkie services in `.github/workflows/ci.yml`), seeds fixtures, runs the gated suites per PR | per-PR |
| **Cloud smoke** | R2 free tier, real S3-compatible fidelity | scheduled / manual only |

#### Time-travel assertions

Against a fixture with ≥3 commits: latest read; `asOf` version N returns the
historical row set; timestamp `asOf` resolves to the commit at-or-before; the
history endpoint returns an ordered timeline with operations.

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Credential exposure (object-storage keys/SAS) | Reuse AES-256-GCM at rest (`crypto.util.ts`); mask in all API responses; decrypt only to mint a request-scoped DuckDB secret. |
| Resource exhaustion (huge tables/scans) | Reuse 10,000-row limit + statement/connection timeouts; set DuckDB `memory_limit` / `threads`; push down `asOf`, projection, and `LIMIT`. |
| Untrusted SQL / side-effecting functions | v1 exposes table scans, not free SQL; reuse the SELECT/scan-only validator; run DuckDB without filesystem/credentials beyond the request secret. |
| In-process DuckDB starves the Node event loop | Singleton instance + bounded connection pool; consider a worker thread for heavy scans; cap concurrency per workspace. |
| Extension download blocked in prod networks | Pre-bundle `iceberg`/`delta`/`httpfs`/`azure` into the backend image; pin extension versions. |
| Native binary / platform mismatch in deploy image | Build the image on the target platform; document the `@duckdb/node-api` platform matrix. |
| Iceberg extension marked experimental upstream | Pin DuckDB + extension versions; gate on the Phase 0 spike; keep the feature behind a flag until validated. |
| Time-travel semantics differ per format | Normalize to a single `TimeTravelPoint`; resolve timestamps to commit-at-or-before; surface the resolved commit in the UI. |

## References

- DuckDB Delta extension (read/write, time travel, Unity Catalog):
  <https://duckdb.org/docs/current/core_extensions/delta> ·
  <https://duckdb.org/2026/05/07/delta-uc-updates>
- DuckDB Iceberg extension (overview, REST catalogs, S3 Tables, S3 import):
  <https://duckdb.org/docs/current/core_extensions/iceberg/overview> ·
  <https://duckdb.org/docs/stable/guides/network_cloud_storage/s3_iceberg_import>
- DuckDB Node "Neo" client; old `duckdb-node` deprecation:
  <https://duckdb.org/docs/lts/clients/node_neo/overview> ·
  <https://github.com/duckdb/duckdb-node-neo>
- Iceberg in the browser (DuckDB-Wasm — future JS path):
  <https://duckdb.org/2025/12/16/iceberg-in-the-browser>
- Icebird — pure-JS Iceberg reader: <https://github.com/hyparam/icebird>
- delta-rs (no first-party Node binding): <https://delta-io.github.io/delta-rs/>
- Apache Hudi reads are engine-centric:
  <https://hudi.apache.org/docs/reading_tables_streaming_reads/>
