# Lakehouse integration fixtures

These immutable fixtures contain three append-only commits of the same table:

| Commit | Rows after commit                 |
| ------ | --------------------------------- |
| 1      | `1, alpha`                        |
| 2      | `1, alpha`; `2, beta`             |
| 3      | `1, alpha`; `2, beta`; `3, gamma` |

- `iceberg/` is an Iceberg v2 table whose metadata uses the stable
  `s3://lakehouse-fixtures/iceberg/default/events` location.
- `delta-events/` is a Delta table with versions 0, 1, and 2.

The checked-in object bytes are the source of truth, so the hot integration
path does not need Python, Spark, or a catalog service. They were generated
with PyIceberg 0.11.1, PyArrow 25.0.0, and delta-rs Python 1.6.2.

Start the existing local MinIO service and seed only the fixture prefixes:

```bash
docker compose up -d --wait minio
pnpm backend fixtures:lakehouse:seed
```

Run the connector-parity suite (design doc §8) with real DuckDB against every
reachable backend — MinIO S3, GCS-interop (HMAC through MinIO), Azurite Azure,
and the local filesystem:

```bash
docker compose up -d --wait minio azurite
RUN_LAKEHOUSE_INTEGRATION_TESTS=true \
  LAKEHOUSE_AZURITE_ENDPOINT=http://127.0.0.1:10000/devstoreaccount1 \
  LAKEHOUSE_ALLOWED_ENDPOINTS=http://127.0.0.1:9000,http://127.0.0.1:10000/devstoreaccount1 \
  pnpm --filter @wafflebase/backend test:e2e \
  test/lakehouse-parity.e2e-spec.ts
```

The suite runs one assertion set per backend × format: latest read, ordered
history, an `asOf` read at every commit, timestamp resolution, and secret
cleanup. Omit `LAKEHOUSE_AZURITE_ENDPOINT` and the Azure leg is skipped.

The Iceberg fixture embeds absolute `s3://lakehouse-fixtures/…` URIs (in its
metadata JSON and inside deflate-compressed avro manifest blocks), so the
Azure and GCS legs seed a rewritten copy into same-length buckets
(`lakehouse-fixturaz`, `lakehouse-fixturgs`): equal-length URI swaps keep the
avro string offsets valid, and the blocks are re-deflated with their size
varints rewritten (`rewriteFixtureFile` in `test/helpers/lakehouse-fixtures.ts`).
Delta embeds only relative paths, so the same bytes serve every leg — which is
also why the local-fs leg is Delta-only.

Two properties of that rewrite are load-bearing if you ever change it:

- **The bucket name must keep the byte length of `lakehouse-fixtures`.** Avro
  strings are length-prefixed, so an equal-length swap keeps every offset
  valid. `targetUriPrefix` throws rather than emitting a corrupt file, so a
  mistake here fails at seed time, not as a mystery read error.
- **Re-deflating changes each manifest's byte length** (measured: up to 3
  bytes shorter across the committed avro files), while the manifest-list
  entry still records the original `manifest_length`. Today's Iceberg
  extension does not read past the compressed block, so it does not care; a
  future stricter reader could. If an az/gs leg starts failing on manifests
  that the minio-s3 leg reads fine, this is the first thing to check.

The test also reseeds before reading. Repeated runs overwrite every immutable
fixture object but do not list or delete unrelated bucket objects. CI starts
with an empty MinIO volume; when regenerating fixture object names locally,
use a fresh disposable volume to avoid retaining files from an older fixture.
Override `LAKEHOUSE_MINIO_ENDPOINT`, `LAKEHOUSE_MINIO_ACCESS_KEY`,
`LAKEHOUSE_MINIO_SECRET_KEY`, or `LAKEHOUSE_MINIO_REGION` to target another
disposable S3-compatible service. The bucket name stays `lakehouse-fixtures`
because Iceberg manifest files embed that stable URI.
Seeding is restricted to loopback endpoints by default. A deliberately chosen
remote disposable target additionally requires
`ALLOW_REMOTE_LAKEHOUSE_FIXTURE_SEED=true`.

### Real-cloud smoke (opt-in, design §8)

Point the minio-s3 leg at any real S3-compatible free tier (Cloudflare R2,
Backblaze B2, AWS S3) and the same assertions run unchanged:

```bash
RUN_LAKEHOUSE_INTEGRATION_TESTS=true \
  ALLOW_REMOTE_LAKEHOUSE_FIXTURE_SEED=true \
  LAKEHOUSE_MINIO_ENDPOINT=https://<account>.r2.cloudflarestorage.com \
  LAKEHOUSE_MINIO_ACCESS_KEY=… LAKEHOUSE_MINIO_SECRET_KEY=… \
  LAKEHOUSE_ALLOWED_ENDPOINTS=https://<account>.r2.cloudflarestorage.com \
  pnpm --filter @wafflebase/backend test:e2e test/lakehouse-parity.e2e-spec.ts
```

Use a dedicated disposable bucket account: seeding writes fixture objects and
never runs on fork PRs (credentials stay out of CI defaults).

## Regenerating fixtures

Regeneration is intentionally outside the normal test path. Iceberg and Delta
create fresh UUIDs, snapshot IDs, timestamps, and Parquet file names, so two
runs are not byte-for-byte identical. `generate.py` makes the semantic
contract deterministic instead: it fixes the nullable `(id BIGINT, value
VARCHAR)` schema and the three append inputs above, then reads every generated
Iceberg snapshot and Delta version back before publishing its output.

Use Python 3.11 or newer and a dedicated, empty MinIO process. Do not point the
generator at the normal development MinIO: it refuses a non-empty
`lakehouse-fixtures` bucket and never deletes existing objects.

```bash
python3 -m venv /tmp/wafflebase-lakehouse-fixture-venv
/tmp/wafflebase-lakehouse-fixture-venv/bin/pip install \
  -r packages/backend/test/fixtures/lakehouse/requirements-regenerate.txt

docker run --rm --name wafflebase-fixture-minio \
  -p 19000:9000 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio:RELEASE.2025-09-07T16-13-09Z server /data
```

Keep that MinIO process running and generate into a new staging path from a
second terminal:

```bash
/tmp/wafflebase-lakehouse-fixture-venv/bin/python \
  packages/backend/test/fixtures/lakehouse/generate.py \
  --output /tmp/wafflebase-lakehouse-fixtures
```

The staged directory contains `iceberg/`, `delta-events/`, and
`fixture-manifest.json`. The manifest records the new random Iceberg metadata
key plus the expected history contract. Review the staged files, replace both
checked-in format directories as one change (do not merge them with the old
UUID-named files), and replace the checked-in manifest too. The integration
helper reads `iceberg.currentMetadataKey` from that manifest. Then seed and run
the focused contract shown above. Stop the dedicated container when finished;
because it uses container-local storage and `--rm`, its generated objects are
discarded.
