---
title: Optional features
description: Turn on share-link analytics, database and lakehouse connections, error tracking, webhooks, and the public template gallery on a self-hosted Wafflebase.
type: how-to
---

# Optional features

Turn on the parts of Wafflebase that stay off until you configure them: share-link analytics, database and lakehouse connections, error tracking, webhooks, and the public template gallery.

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

## Turn on webhooks

Webhooks let workspace owners send signed events to n8n, Zapier, or their own servers. See [Webhooks](/developers/webhooks) for the owner side.

1. Set an encryption key for signing secrets. If `DATASOURCE_ENCRYPTION_KEY` is already set, it is used and you can skip this step.

   ```env
   WAFFLEBASE_SECRETS_ENCRYPTION_KEY=<64 hex characters from openssl rand -hex 32>
   ```

2. Turn webhooks on and restart the backend:

   ```env
   WAFFLEBASE_WEBHOOKS_ENABLED=true
   ```

3. Optional: let webhooks reach a service on your own network, such as an n8n at `10.0.4.12`. Webhooks refuse private addresses and `http://` unless you allow them:

   ```env
   WAFFLEBASE_WEBHOOK_ALLOWED_CIDRS=10.0.4.0/24
   WAFFLEBASE_WEBHOOK_ALLOW_HTTP=true
   ```

Every backend replica sends deliveries; they share the work through the database, so you do not need a separate worker. Without a key, the boot log says `webhooks are enabled but unusable` and creating a webhook fails with the same reason.

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

2. Render their thumbnails offline. This needs Chromium, but no running frontend or backend:

   ```bash
   pnpm --filter @wafflebase/frontend exec playwright install chromium
   pnpm backend template:dump --out catalog.json
   pnpm frontend render:thumbnails catalog.json --out thumbs/
   ```

3. Publish, submit, and approve each one, on a host with the backend's environment:

   ```bash
   pnpm backend sync:templates:build --author <userId> --thumbnails thumbs/
   ```

This step writes each template's content and approves only once the Yorkie event webhook (`/internal/yorkie/events`) has reported that write back, so that webhook must be registered on your Yorkie project. Without it, every template fails with a message saying so and nothing is approved.

4. Spreadsheet, document, and board templates cannot be rendered offline yet, so step 3 skips them. Until they can, publish those through the product's own Share dialog — with the frontend and backend running:

   ```bash
   pnpm backend register:templates:build --author <userId> --frontend https://app.example.com
   ```

   This command handles only those three types, and skips documents that already have a listing (`--reset` unpublishes and publishes them again). It goes away once every type renders offline.

Whenever the catalogue changes, run steps 1 to 3 again. Step 1 creates the documents for any seeds added since and leaves existing documents unchanged. Step 3 rewrites a slides or note template whose content changed, updates only what changed, re-approves it, and keeps every preview link already handed out.

Steps 1 to 3 do not update a spreadsheet, document, or board template that is already published. To bring one up to date, rewrite its document and publish it again:

```bash
pnpm backend seed:templates:build --workspace <workspaceId> --author <userId> --force-content
pnpm backend register:templates:build --author <userId> --frontend https://app.example.com --reset
```

`--force-content` rewrites every seeded document from the catalogue, slides and notes included, and a content change returns a public template to review. Run step 3 again afterwards to re-approve the slides and note templates. `--reset` unpublishes each spreadsheet, document, and board template and publishes it again, so those templates leave the public gallery until they are re-approved, and their old preview links stop working.

## Related

- [Configuration](/developers/self-hosting/configuration) for every variable these features read.
- [Deploy to production](/developers/self-hosting/deploy) for access control and storage.
- [Troubleshooting](/developers/self-hosting/troubleshooting) if a feature fails after you turn it on.
