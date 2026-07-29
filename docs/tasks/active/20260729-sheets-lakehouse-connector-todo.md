# Sheets Lakehouse Connector (issue #552) — todo

Implements `docs/design/sheets/lakehouse-connected-sheet.md` §3 (Backend
Lakehouse Module) + §4 (Time-Travel Slider) as one PR, per maintainer guidance
on the issue. The design doc is the fixed spec; nothing here changes it.

## Backend

- [x] `LakehouseSource` Prisma model per design §2: `catalogMode`
      (`CatalogMode` enum incl. `unity`), `catalogUri`, nullable
      `basePath`/`credentials`; AES-256-GCM credential blob reused.
- [x] Embedded DuckDB engine service (`@duckdb/node-api`): long-lived
      instance, bounded pool/queue, statement timeouts, memory/thread caps,
      fail-closed poisoning on cleanup failure.
- [x] Direct-metadata reads: `iceberg_scan` (+ `snapshot_from_id`),
      `delta_scan` (+ `ATTACH … AT (VERSION => ?)`), fixed SQL templates with
      bound parameters only; path/glob/traversal validation; request-scoped
      `CREATE SECRET … SCOPE` per storage kind with guaranteed cleanup.
- [x] Storage kinds: s3, s3-compatible (MinIO/R2), gcs (HMAC interop, incl.
      custom endpoint), azure (connection string / account+key / SAS), local
      (realpath-confined under `LAKEHOUSE_LOCAL_ROOT`).
- [x] API endpoints (design §3 table): CRUD + `test` + `read` + `history` +
      `tables` (catalog mode), JWT + workspace-membership gated.
- [x] Catalog mode: `rest_catalog` (ATTACH + optional bearer secret) and
      `s3_tables` (ARN + `ENDPOINT_TYPE s3_tables`); `unity` reserved in the
      enum but rejected until an attach path is designed.
- [x] Time travel: version / snapshot / **timestamp** (`asOf` resolves to the
      commit at-or-before via the history listing, design §4).

## Frontend

- [x] Lakehouse tab type + `lakehouseRef` + `asOf` persisted to Yorkie
      `TabMeta` (design §1); worksheet-shape migration tolerates old docs.
- [x] `LakehouseDialog` (create/edit per storage kind), `LakehouseSelector`,
      `LakehouseView` over `ReadOnlyStore`, `TimeTravelSlider` with commit
      stops + Latest affordance.

## Test strategy (design §8)

- [x] Unit: SQL plans, secret plans, validators, DTOs, service (incl. catalog
      + timestamp paths), DuckDB pool/timeout behavior — no network.
- [x] Committed 3-commit Iceberg + Delta fixtures + manifest + regeneration
      script (PyIceberg/delta-rs, pinned).
- [x] Connector-parity suite: one assertion set × [minio-s3, gcs-interop,
      azurite-azure, local-fs] × [iceberg, delta] — latest read, ordered
      history, `asOf` at every commit, timestamp resolution, secret cleanup.
      Iceberg's embedded URIs are relocated at seed time by a same-length
      scheme/bucket rewrite (JSON + deflated avro blocks).
- [x] CI: MinIO + Azurite containers in `verify-integration`;
      `verify:integration:docker` starts/awaits both locally.
- [x] Real-cloud smoke: parity suite runs unchanged against any real
      S3-compatible endpoint via env (documented in the fixtures README);
      opt-in, never on fork PRs.

## Remaining before merge

- [x] Production backend image build + `smoke-duckdb-runtime.cjs` inside it
      (extension availability for the deploy platform). Built and smoked on
      linux/arm64 and linux/amd64; the cold-start smoke found the first
      lakehouse request of a fresh container failing once (DuckDB Secret
      Manager settings rejected right after the extension download) — fixed by
      rebuilding the instance once when hardening fails, and the smoke now
      drives the compiled `DuckDbService` so CI reproduces the cold path.
- [x] Manual smoke in `pnpm dev` (UI changed): S3-compatible, Azurite and
      local storage through the dialog, Delta and Iceberg, time travel and
      two-browser `asOf` sync. Real S3/GCS remain env-driven opt-ins.
- [ ] `pnpm verify:self`.
- [ ] Capture lessons, archive task files after merge.
