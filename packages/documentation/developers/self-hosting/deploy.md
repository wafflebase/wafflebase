---
title: Deploy to production
description: Build the backend image and the frontend with your own URLs, run migrations, connect storage, and turn on access control.
type: how-to
---

# Deploy to production

Build the backend image and the frontend with your own URLs, run migrations, connect storage, and turn on per-document access control.

::: info Before you start
- Run PostgreSQL, a Yorkie server with a project for Wafflebase, and an S3-compatible object store yourself. The image contains the backend only.
- Have a domain for the frontend and one for the backend, with TLS, and a GitHub OAuth app. See [Sign-in providers](/developers/self-hosting/sign-in).
- Have the Yorkie admin CLI (`yorkie`) to register webhooks.
:::

## Build and run the backend image

1. From the repository root, build the image:

   ```bash
   docker build -t wafflebase-backend .
   ```

2. Run it with your configuration:

   ```bash
   docker run --env-file backend.env -p 3000:3000 wafflebase-backend
   ```

The image runs `node dist/main` on port `3000` and sets `NODE_ENV=production`. It bundles the DuckDB extensions the lakehouse connector needs, so it needs no internet access for them. It is based on Debian (`node:22-bookworm-slim`), not Alpine. For the variables to put in `backend.env`, see [Configuration](/developers/self-hosting/configuration).

## Run database migrations

1. Apply pending migrations before the new image serves traffic. From a checkout:

   ```bash
   pnpm --filter @wafflebase/backend exec prisma migrate deploy
   ```

   Or as a one-off job or init container using the image:

   ```bash
   cd /app/packages/backend && npx prisma@6.6.0 migrate deploy
   ```

::: danger
Do not run `pnpm backend migrate` against production. It runs `prisma migrate dev`, which can create migration files and offer to reset the database.
:::

## Build the frontend

The frontend's backend and Yorkie addresses are compiled in. A build with nothing configured points every browser at `http://localhost:3000`.

1. Create `packages/frontend/.env.production.local` from the template `packages/frontend/.env.production.example`, and fill in your values:

   ```env
   VITE_BACKEND_API_URL=https://api.example.com
   VITE_YORKIE_RPC_ADDR=https://yorkie.example.com
   VITE_YORKIE_PUBLIC_KEY=your_yorkie_public_key
   ```

   In CI, pass the same variables on the build command instead. They override every file.

2. Build the app and the in-app documentation together:

   ```bash
   pnpm build:all
   ```

   The output is `packages/frontend/dist`, with the documentation at `dist/docs`. To build the app alone, run `pnpm core build` and then `pnpm frontend build`.

3. Check that your backend's host is in the app build. The `docs` directory is skipped because these pages mention example hosts:

   ```bash
   grep -rl --exclude-dir=docs 'api.example.com' packages/frontend/dist
   ```

   It must print at least one file. Also check that `grep -rl --exclude-dir=docs 'api.wafflebase.io' packages/frontend/dist` prints nothing.

4. Serve `packages/frontend/dist` from any static host or CDN, with a fallback to `index.html` for unknown paths.

Use `.env.production.local`, not `.env.local`: `.env.local` ranks below `.env.production`. Ignore `api.yorkie.dev` in the build output; it is the Yorkie SDK's own default and is always present. For the full variable list, see [Frontend: build-time variables](/developers/self-hosting/configuration#frontend-build-time-variables).

## Set up blob storage

Wafflebase stores blobs in two S3-compatible buckets: one for uploaded files (`FILE_STORAGE_*`) and one for images embedded in documents (`IMAGE_STORAGE_*`).

1. Create both buckets, for example `wafflebase-files` and `wafflebase-images`.
2. Give the backend's credentials object read and write access to them. If you skip step 1, the credentials also need `s3:CreateBucket`.
3. Set all five variables for each bucket (endpoint, bucket, region, access key, secret key). In production nothing falls back to MinIO.
4. Optional: set `FILE_STORAGE_PREFIX` or `IMAGE_STORAGE_PREFIX` to share a bucket with another app. Do not change a prefix after the first upload; existing objects stop resolving.

At startup the backend checks each bucket and tries to create a missing one. A failure is logged as a warning and the server starts anyway; uploads then fail until storage works. If one bucket is misconfigured, only that feature stops working.

| Upload | Limit | Types |
|--------|-------|-------|
| File uploaded as a document | 100 MB; 25 MB for images | Any file |
| Image inserted into a document | 10 MB | PNG, JPEG, GIF, WebP |

These limits are fixed. An upload over the limit is refused with `413`, or with `400 File too large (max 25 MB)` for an image file between 25 MB and 100 MB. The editors downscale a larger image before inserting it, so the 10 MB limit rarely shows. Set your proxy's request body limit to at least 100 MB so it does not refuse uploads first.

## Run behind a TLS proxy

1. Set `BACKEND_TRUST_PROXY=1`, or your real number of proxy hops.
2. Set `GITHUB_CALLBACK_URL` to the `https://` URL users reach. If you cannot, set `COOKIE_SECURE=true`.
3. Set `FRONTEND_URL` to the frontend's public origin.
4. Set `WAFFLEBASE_API_ORIGIN` to the backend's public origin, the same value as `VITE_BACKEND_API_URL`.

## Turn on per-document access control

Browsers connect to Yorkie directly. Until you register the auth webhook, Yorkie checks no workspace membership or share-link role, and anyone who can reach it can open or change a document whose key they know.

1. Set `YORKIE_SECRET_KEY` on the backend to your Yorkie project's secret key.
2. Register the auth webhook on the Yorkie project:

   ```bash
   yorkie login -u <admin-user> --rpc-addr yorkie.example.com:443
   yorkie project update <project> \
     --auth-webhook-url https://api.example.com/internal/yorkie/auth \
     --auth-webhook-method-add AttachDocument \
     --auth-webhook-method-add PushPull \
     --auth-webhook-method-add Watch \
     --auth-webhook-method-add DetachDocument \
     --auth-webhook-method-add Broadcast \
     --auth-webhook-method-add RemoveDocument \
     --auth-webhook-method-add ListRevisions \
     --auth-webhook-method-add GetRevision \
     --auth-webhook-method-add RestoreRevision
   ```

3. Check the backend log. It says `yorkie auth webhook: enforcing per-document access`. This line reflects only `YORKIE_AUTH_WEBHOOK_ENFORCE`; it cannot tell whether step 2 was done.

With `YORKIE_AUTH_WEBHOOK_ENFORCE` unset, access is enforced as soon as the methods are registered. Viewers can read a document but not change it, and only members and editors can see or restore its version history. To remove the webhook, run `yorkie project update <project> --auth-webhook-method-rm ALL`.

::: warning
Do not register `CreateRevision`. Yorkie sends it without a document, so registering it stops everyone, owners included, from naming a version in version history.
:::

### Watch decisions before enforcing

1. Set `YORKIE_AUTH_WEBHOOK_ENFORCE=false` and restart. The log shows a `SHADOW mode` warning, and decisions are logged but never enforced.
2. Use the app and confirm the log shows no wrong denials.
3. Unset the variable and restart.

::: danger
Shadow mode allows everything, including writes from viewer share links and reading or restoring version history. Do not leave a deployment in it.
:::

### Keep the documents list in edit order

1. Register the event webhook so the documents list sorts by last edit:

   ```bash
   yorkie project update <project> \
     --event-webhook-url https://api.example.com/internal/yorkie/events \
     --event-webhook-events-add DocumentRootChanged
   ```

The webhook URL can be an internal address the Yorkie server reaches; it does not need to be public.

## Check health

| Endpoint | Returns |
|----------|---------|
| `GET /health` | `200` while the process runs |
| `GET /health/ready` | `200` when the database is reachable, `503` when it is not |

Use `/health` as the liveness probe and `/health/ready` as the readiness probe.

## Known limitations

- The image does not include the frontend, PostgreSQL, Yorkie, or object storage.
- Upload limits cannot be changed by configuration.
- Back up PostgreSQL, Yorkie's data store, and both buckets together; each holds part of every document.

## Related

- [Configuration](/developers/self-hosting/configuration) for every variable.
- [Optional features](/developers/self-hosting/optional-features) to add analytics, lakehouse, error tracking, or the public template gallery.
- [Troubleshooting](/developers/self-hosting/troubleshooting) for errors after deploying.
- [Yorkie auth webhook design](https://github.com/wafflebase/wafflebase/blob/main/docs/design/yorkie-auth-webhook.md) for how access decisions are made.
