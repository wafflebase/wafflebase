---
title: Optional features
description: Turn on share-link analytics, database and lakehouse connections, error tracking, and the public template gallery on a self-hosted Wafflebase.
type: how-to
---

# Optional features

Turn on the parts of Wafflebase that stay off until you configure them: share-link analytics, database and lakehouse connections, error tracking, and the public template gallery.

Each feature is independent. Leaving one off does not affect the rest of the app.

## Turn on share-link analytics

Share-link analytics records views, unique and returning visitors, and time spent for documents opened through a share link. It runs on Kafka and StarRocks.

1. Start Kafka and StarRocks. Locally, use the Compose profile:

   ```bash
   docker compose --profile analytics up -d
   ```

   This starts `kafka` (`29092`) and `starrocks` (`8030`, `9030`, `8040`), and creates the topic, table, and load job.

2. Point the backend at them:

   ```env
   WAFFLEBASE_KAFKA_ADDRESSES=localhost:29092
   WAFFLEBASE_KAFKA_TOPIC=wafflebase-view-events
   WAFFLEBASE_STARROCKS_DSN=root:@tcp(localhost:9030)/wafflebase
   ```

3. Restart the backend.
4. Open a document through a share link to record a view.

An **Analytics** entry appears in the workspace sidebar, at `/w/<workspaceId>/analytics`. Document managers also see per-document analytics. Leave the variables unset until the services run; pointing at brokers that are down only produces connection errors.

## Connect databases and lakehouse tables

Sheets can read from external databases and from Iceberg and Delta tables. See [Connect a database](/sheets/connect-a-database) and [Lakehouse](/sheets/lakehouse) for the user side.

1. Generate an encryption key for stored credentials and set it:

   ```bash
   openssl rand -hex 32
   ```

   ```env
   DATASOURCE_ENCRYPTION_KEY=<the 64 hex characters>
   ```

2. To use a custom S3, Azure, or GCS endpoint or an Iceberg REST catalog, list each exact origin:

   ```env
   LAKEHOUSE_ALLOWED_ENDPOINTS=https://s3.example.com,https://catalog.example.com
   ```

3. Optional: to let lakehouse tables read the server's own disk, set `LAKEHOUSE_ALLOW_LOCAL_PATHS=true` and `LAKEHOUSE_LOCAL_ROOT` to the only directory they may use.
4. Restart the backend.

Keep `DATASOURCE_ENCRYPTION_KEY` safe and stable; changing it makes stored credentials unreadable. Tune query limits with the `LAKEHOUSE_*` variables in [Configuration](/developers/self-hosting/configuration#backend-datasources-and-lakehouse).

### Run the lakehouse without internet access

The lakehouse needs the DuckDB extensions `httpfs`, `iceberg`, `delta`, `azure`, and `avro`. The production image already contains them (about 170 MB). Outside the image, DuckDB downloads a missing extension from `extensions.duckdb.org` on first use.

1. If the server cannot reach the internet and you do not use the image, copy the extensions into a directory on the server.
2. Set `LAKEHOUSE_DUCKDB_EXTENSION_DIR` to that directory.

## Report errors to Sentry

Error tracking sends backend and browser errors to a Sentry project you own. It is off until you set a DSN.

1. Create a Sentry project for the backend and one for the frontend.
2. Set the backend DSN and restart:

   ```env
   SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>
   ```

3. Build the frontend with the browser DSN:

   ```bash
   VITE_SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project> pnpm frontend build
   ```

4. Optional: to upload source maps, also set `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` in the build environment. The build uploads the maps and removes them from `dist`.

Traces are sampled at 10% by default. Change it with `SENTRY_TRACES_SAMPLE_RATE` and `VITE_SENTRY_TRACES_SAMPLE_RATE`. No session replays are recorded.

## Open the public template gallery

Workspace and link-only templates work without setup. The public gallery, where anyone on your instance can browse approved templates, needs reviewers and enforced access control. See [Templates](/collaborate/templates) for the user side.

1. Turn on access control and confirm it is enforcing. See [Turn on per-document access control](/developers/self-hosting/deploy#turn-on-per-document-access-control).
2. Set `YORKIE_AUTH_WEBHOOK_ENFORCE=true`. The gallery requires this exact value; unset is not enough.
3. Find the user IDs of your reviewers:

   ```sql
   SELECT id, email FROM "User";
   ```

4. Set them and restart the backend:

   ```env
   WAFFLEBASE_TEMPLATE_REVIEWER_IDS=1,7
   ```

Reviewers decide submissions at `/admin/templates` and are notified when one arrives. Until both settings hold, publishers cannot submit to the public gallery.

### Seed the gallery with starter templates

1. Create the starter documents in a workspace, as a user who is also a reviewer:

   ```bash
   pnpm backend seed:templates:build --workspace <workspaceId> --author <userId>
   ```

2. Install Chromium for the registration step:

   ```bash
   pnpm --filter @wafflebase/frontend exec playwright install chromium
   ```

3. With the frontend and backend running, publish, submit, and approve each one:

   ```bash
   pnpm backend register:templates:build --author <userId> --frontend https://app.example.com
   ```

The second command skips documents that already have a listing. Add `--reset` to unpublish and publish them again.

## Related

- [Configuration](/developers/self-hosting/configuration) for every variable these features read.
- [Deploy to production](/developers/self-hosting/deploy) for access control and storage.
- [Troubleshooting](/developers/self-hosting/troubleshooting) if a feature fails after you turn it on.
