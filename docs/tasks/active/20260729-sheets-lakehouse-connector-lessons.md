# Sheets Lakehouse Connector — lessons

- **Fixture portability beats fixture duplication.** The committed Iceberg
  fixture embeds absolute `s3://bucket/…` URIs in metadata JSON and inside
  deflate-compressed avro manifest blocks. Instead of committing per-scheme
  fixture trees, seed-time rewriting with a SAME-LENGTH scheme + bucket
  (`s3://lakehouse-fixtures` → `az://lakehouse-fixturaz` /
  `gs://lakehouse-fixturgs`) keeps every avro string offset valid; the
  deflate blocks are re-compressed and their size varints rewritten. Verified
  empirically: DuckDB reads snapshots and time-travels on the rewritten
  copies (manifest_length drift of a few bytes did not matter).
- **Delta is relocatable, Iceberg is not.** Delta logs reference data files
  relatively, so one fixture serves every storage backend including local FS.
  That is why the local-fs parity leg is Delta-only.
- **DuckDB `TYPE gcs` secrets accept `ENDPOINT`** — the GCS HMAC-interop path
  can be exercised against MinIO in CI (design §8's blessed alternative to a
  GCS emulator), and the same field serves real custom interop endpoints.
- **Azurite needs `--skipApiVersionCheck`** with current `@azure/storage-blob`
  SDKs, or every request 400s on the API version gate.
- **Validation must throw before the connection test swallows errors.** The
  test endpoints report `{ success: false }` for reachability problems, but
  malformed configurations (endpoint injection attempts included) must reject
  with 400 — validating inside the try/catch silently downgraded those.
- **Timestamp time travel is an API-layer resolution.** Resolving
  `{ kind: 'timestamp' }` to the commit at-or-before via the history listing
  keeps the SQL planners two-kind (version/snapshot) and the resolved commit
  surfaces to the UI, matching design §4 without new engine syntax.
- **A cold container is the only place the cold path runs.** On a fresh
  extension directory the very first `SET allow_persistent_secrets = false`
  after `INSTALL` downloads fails with DuckDB's "Changing Secret Manager
  settings after the secret manager is used is not allowed!", and the next
  instance in the same process accepts it (reproduced on arm64 and amd64
  images; not tied to instance config or to LOAD ordering). A developer
  machine never sees this because its extensions are already cached, so the
  bug survived every local lane and surfaced only when the production image
  was booted and hit once. Two consequences: `initialize()` rebuilds the
  instance once when hardening fails (a second failure propagates), and
  `smoke-duckdb-runtime.cjs` drives the compiled `DuckDbService` instead of
  the raw DuckDB client, so `verify-backend-image` exercises the exact
  request-time initialization rather than a hand-written approximation.
- **Read-only tabs have no peer selection, by inheritance.** DataSource and
  Lakehouse tabs both run on `ReadOnlyStore`, whose `updateSelection()` is a
  no-op and `getPresences()` returns `[]`; collaborators share the time-travel
  point (`asOf` in `TabMeta`), not cursors. `LakehouseView` clears its own
  selection presence on mount so peers still on a sheet tab do not see a
  stale cursor. Presence on read-only tabs is a datasource-spine follow-up,
  listed as a known limitation.
- **Fail-closed must still be bounded.** A timed-out lease is normally
  returned when its interrupted statement settles, and that return is what
  tears the poisoned instance down. Review (#868) pointed out the hole: a
  native operation that never honours the interrupt would hold the lease
  forever and keep every later request failing with "engine is restarting"
  until the process restarted. The escape hatch is to *abandon* the stuck
  connection after a grace period rather than close it (closing a connection
  mid-statement can block the event loop), rebuild the engine without it, and
  guard the orphan's late cleanup failure by generation so it cannot poison
  the replacement it never touched. The credential invariant survives: the
  replacement instance never held the orphan's secret.
