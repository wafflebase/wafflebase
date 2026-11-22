---
title: Configuration
description: Every backend environment variable and frontend build-time variable a Wafflebase deployment reads.
type: reference
---

# Configuration

Every environment variable a Wafflebase deployment reads, grouped by feature.

**Conventions.** Backend variables go in `packages/backend/.env` or the container environment and are read when the process starts. Frontend `VITE_*` variables are compiled into the bundle when you build it; setting them on the server that serves the files does nothing. The backend does not validate its configuration as a whole at boot. Only `JWT_SECRET` stops startup when missing; most other values fail when the feature that reads them first runs.

## Backend: required

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `DATABASE_URL` | Yes | none | PostgreSQL connection string |
| `JWT_SECRET` | Yes | none | Signs access tokens and Yorkie auth tokens, and refresh tokens unless `JWT_REFRESH_SECRET` is set. Missing, the backend exits with `JWT_SECRET is required` |
| `GITHUB_CLIENT_ID` | Yes | none | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | Yes | none | GitHub OAuth app client secret |
| `GITHUB_CALLBACK_URL` | Yes | none | `https://<backend>/auth/github/callback`. Its scheme also decides whether cookies are `Secure`; see [Serve sign-in over HTTPS](/developers/self-hosting/sign-in#serve-sign-in-over-https) |
| `FRONTEND_URL` | Yes | none | Frontend public origin. The CORS origin and the post-login redirect target |

## Backend: server and runtime

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `PORT` | No | `3000` | HTTP port |
| `NODE_ENV` | No | unset; `production` in the image | `production` removes the MinIO storage defaults and is the last fallback for `Secure` cookies |
| `LOG_LEVEL` | No | `info` | Pino log level |
| `BACKEND_TRUST_PROXY` | No | `0` | Number of proxy hops to trust for the client IP. Set `1` behind one TLS proxy |
| `BACKEND_JSON_BODY_LIMIT` | No | `25mb` | Request body limit for JSON, form, and text bodies. Raise it if large imports with inline images are rejected |
| `WAFFLEBASE_API_ORIGIN` | No | origin of `GITHUB_CALLBACK_URL` | The backend's public origin. Used to recognize this deployment's own absolute image URLs when copying a document across workspaces. Set it to the same origin as `VITE_BACKEND_API_URL` |

::: danger
Set `BACKEND_TRUST_PROXY` only when a proxy really is in front. At `0` behind a proxy, every request shares one rate-limit bucket. Above `0` with no proxy, clients can spoof `X-Forwarded-For` and evade rate limits.
:::

## Backend: sessions and cookies

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `JWT_REFRESH_SECRET` | No | `JWT_SECRET` | Signs refresh tokens. Set an independent value |
| `JWT_ACCESS_EXPIRES_IN` | No | `1h` | Access token lifetime |
| `JWT_REFRESH_EXPIRES_IN` | No | `7d` | Refresh token lifetime |
| `JWT_ACCESS_COOKIE_MAX_AGE_MS` | No | `3600000` | Access cookie lifetime. Keep it consistent with the token lifetime |
| `JWT_REFRESH_COOKIE_MAX_AGE_MS` | No | `604800000` | Refresh cookie lifetime |
| `COOKIE_SECURE` | No | derived | `true`/`1` or `false`/`0` forces `Secure` cookies on or off. Unset, it follows the scheme of `GITHUB_CALLBACK_URL`, then `NODE_ENV=production` |

## Backend: GitHub Enterprise

Set all four to sign in against a GitHub Enterprise Server instance. Unset, sign-in uses github.com. See [Use GitHub Enterprise](/developers/self-hosting/sign-in#use-github-enterprise).

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `GITHUB_AUTHORIZATION_URL` | No | github.com | `https://<host>/login/oauth/authorize` |
| `GITHUB_TOKEN_URL` | No | github.com | `https://<host>/login/oauth/access_token` |
| `GITHUB_USER_PROFILE_URL` | No | github.com | `https://<host>/api/v3/user` |
| `GITHUB_USER_EMAIL_URL` | No | github.com | `https://<host>/api/v3/user/emails` |

## Backend: Google sign-in

Set all three to show **Continue with Google**. With any one missing, Google sign-in is off and the backend logs which variable is missing. See [Set up Google sign-in](/developers/self-hosting/sign-in#set-up-google-sign-in).

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `GOOGLE_CLIENT_ID` | No | none | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | none | Google OAuth client secret |
| `GOOGLE_CALLBACK_URL` | No | none | `https://<backend>/auth/google/callback`. Required, unlike GitHub's |

## Backend: Yorkie

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `YORKIE_RPC_ADDR` | No | `http://localhost:8080` | Yorkie address the backend uses. Browsers use `VITE_YORKIE_RPC_ADDR` instead |
| `YORKIE_PUBLIC_KEY` | No | none | Yorkie project public key for the backend's client |
| `YORKIE_SECRET_KEY` | For production | none | Yorkie project secret key. Verifies the auth and event webhooks, and shows who is editing in the documents list. Without it, both webhooks are refused |
| `YORKIE_TOKEN_EXPIRES_IN` | No | `10m` | Lifetime of the token browsers present to the Yorkie auth webhook |
| `YORKIE_AUTH_WEBHOOK_ENFORCE` | No | unset (enforce) | Only `false` (any case) selects shadow mode, which logs decisions but allows every request. The public template gallery requires the literal `true` |

## Backend: blob storage

Two buckets with independent settings. Outside production each value falls back to the local MinIO container (`http://localhost:9000`, region `us-east-1`, keys `minioadmin`). With `NODE_ENV=production` there are no fallbacks. See [Set up blob storage](/developers/self-hosting/deploy#set-up-blob-storage).

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `FILE_STORAGE_ENDPOINT` | In production | MinIO | S3 endpoint for uploaded files, PDFs, and image documents |
| `FILE_STORAGE_BUCKET` | In production | `wafflebase-files` | Bucket name |
| `FILE_STORAGE_REGION` | In production | `us-east-1` | Region |
| `FILE_STORAGE_ACCESS_KEY` | In production | `minioadmin` | Access key |
| `FILE_STORAGE_SECRET_KEY` | In production | `minioadmin` | Secret key |
| `FILE_STORAGE_PREFIX` | No | empty | Object-key prefix inside a shared bucket. Surrounding `/` are trimmed. Do not change it after the first upload |
| `IMAGE_STORAGE_ENDPOINT` | In production | MinIO | S3 endpoint for images embedded in sheets, docs, slides, and boards |
| `IMAGE_STORAGE_BUCKET` | In production | `wafflebase-images` | Bucket name |
| `IMAGE_STORAGE_REGION` | In production | `us-east-1` | Region |
| `IMAGE_STORAGE_ACCESS_KEY` | In production | `minioadmin` | Access key |
| `IMAGE_STORAGE_SECRET_KEY` | In production | `minioadmin` | Secret key |
| `IMAGE_STORAGE_PREFIX` | No | empty | Object-key prefix, as above |

## Backend: datasources and lakehouse

Out-of-range integers are clamped to the nearest bound and non-integers keep the default; both log a warning at startup. An invalid memory limit falls back to `512MB` without a warning.

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `DATASOURCE_ENCRYPTION_KEY` | To use datasources | none | 64 hex characters (`openssl rand -hex 32`). Encrypts stored database and lakehouse credentials. Changing it makes stored credentials unreadable |
| `LAKEHOUSE_ALLOWED_ENDPOINTS` | No | empty | Comma-separated exact HTTP(S) origins allowed as custom S3, Azure, or GCS endpoints and Iceberg REST catalogs. Empty allows none |
| `LAKEHOUSE_QUERY_TIMEOUT_MS` | No | `30000` | Query timeout, `100`–`300000` |
| `LAKEHOUSE_DUCKDB_MEMORY_LIMIT` | No | `512MB` | Integer followed by `KB`, `MB`, or `GB` |
| `LAKEHOUSE_DUCKDB_THREADS` | No | `2` | `1`–`32` |
| `LAKEHOUSE_DUCKDB_POOL_SIZE` | No | `2` | `1`–`8`. Operations still run one at a time |
| `LAKEHOUSE_DUCKDB_MAX_PENDING` | No | `64` | Queued operations, `1`–`1000` |
| `LAKEHOUSE_DUCKDB_EXTENSION_DIR` | No | `~/.duckdb`; `/app/.duckdb-extensions` in the image | Where DuckDB loads extensions from |
| `LAKEHOUSE_ALLOW_LOCAL_PATHS` | No | `false` | `true` lets lakehouse tables read the server's own filesystem |
| `LAKEHOUSE_LOCAL_ROOT` | With local paths | none | The only directory local paths may point into |

## Backend: webhooks

Webhooks stay off until `WAFFLEBASE_WEBHOOKS_ENABLED` is `true`. See [Webhooks](/developers/webhooks) for the owner side.

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `WAFFLEBASE_WEBHOOKS_ENABLED` | To use webhooks | off | Only the exact value `true` turns webhooks on. Off, nothing is recorded or sent and owners see a muted **Webhooks** section |
| `WAFFLEBASE_SECRETS_ENCRYPTION_KEY` | With webhooks, unless `DATASOURCE_ENCRYPTION_KEY` is set | `DATASOURCE_ENCRYPTION_KEY` | 64 hex characters (`openssl rand -hex 32`). Encrypts webhook signing secrets. Changing it makes existing webhooks unable to sign; delete and re-create them |
| `WAFFLEBASE_WEBHOOK_ALLOWED_CIDRS` | No | empty | Comma-separated exact CIDRs, such as `10.0.4.0/24`, that webhooks may reach although they are private addresses. Entries that do not parse are ignored |
| `WAFFLEBASE_WEBHOOK_ALLOW_HTTP` | No | off | Only the exact value `true` allows `http://` endpoints |
| `WAFFLEBASE_WEBHOOK_QUIET_MS` | No | `60000` | `document.content_updated` is sent once a document has had no edits for this long |
| `WAFFLEBASE_WEBHOOK_MAX_WAIT_MS` | No | `300000` | …or at most this long after the first edit, while editing continues |

`url` and `api_url` in payloads come from `FRONTEND_URL` and `WAFFLEBASE_API_ORIGIN` (falling back to the origin of `GITHUB_CALLBACK_URL`).

## Backend: templates

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `WAFFLEBASE_TEMPLATE_REVIEWER_IDS` | For the public gallery | empty | Comma-separated user IDs allowed to approve public templates. Empty means nobody, which keeps the public gallery closed. Entries that are not positive integers are ignored |

## Backend: share-link analytics

Set all three to turn analytics on. The Kafka brokers turn on recording views; the StarRocks DSN turns on the dashboards and the **Analytics** sidebar entry. Without the DSN, the dashboard says analytics is not enabled.

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `WAFFLEBASE_KAFKA_ADDRESSES` | No | none | Comma-separated Kafka brokers for view events. Unset, no views are recorded |
| `WAFFLEBASE_KAFKA_TOPIC` | No | `wafflebase-view-events` | Kafka topic for view events |
| `WAFFLEBASE_STARROCKS_DSN` | No | none | `user:pass@tcp(host:port)/db` for the analytics warehouse. Unset, the dashboards are off |

## Backend: error tracking

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `SENTRY_DSN` | No | none | Your Sentry project DSN. Unset, nothing is reported |
| `SENTRY_ENVIRONMENT` | No | `NODE_ENV` | `environment` tag on every event |
| `SENTRY_RELEASE` | No | backend package version | `release` tag on every event |
| `SENTRY_TRACES_SAMPLE_RATE` | No | `0.1` | Trace sampling rate, `0`–`1`. Invalid values use `0.1` |

## Backend: demo reset

Restores chosen documents to a pinned version once a day. Unset, no timer runs.

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `WAFFLEBASE_DEMO_RESET_TARGETS` | No | none | Comma-separated `<shareToken>:<revisionId>` pairs. An entry without `:<revisionId>` is not reset; its recent versions with the label below are logged at startup so you can pick an ID. Editor share tokens are write credentials, so set this from a secret |
| `WAFFLEBASE_DEMO_RESET_LABEL` | No | `demo-golden` | Version name the startup listing filters on |
| `WAFFLEBASE_DEMO_RESET_HOUR_UTC` | No | `15` | Hour of day (UTC, `0`–`23`) the reset runs. Invalid values use `15` |

## Frontend: build-time variables

Supply these when you run `pnpm frontend build`. See [Build the frontend](/developers/self-hosting/deploy#build-the-frontend) for where to put them.

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `VITE_BACKEND_API_URL` | Yes | `http://localhost:3000` | Public origin of the backend |
| `VITE_YORKIE_RPC_ADDR` | Yes | `http://localhost:8080` | Address browsers reach Yorkie at |
| `VITE_YORKIE_PUBLIC_KEY` | If your Yorkie project has one | empty | Yorkie project public key. Not a secret |
| `VITE_FRONTEND_BASENAME` | No | `/` | Router base path. Serving from a subpath needs more than this variable |
| `VITE_GA_ID` | No | none | Google Analytics measurement ID. Leave unset unless the property is yours |
| `VITE_SENTRY_DSN` | No | none | Your Sentry project DSN for browser errors |
| `VITE_SENTRY_ENVIRONMENT` | No | build mode (`production`) | `environment` tag |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | No | `0.1` | Trace sampling rate, `0`–`1` |
| `VITE_DEMO_SHARED_TOKEN` | No | none | Share token for the sheet demo on the homepage |
| `VITE_DEMO_DOC_SHARED_TOKEN` | No | none | Share token for the docs demo |
| `VITE_DEMO_SLIDES_SHARED_TOKEN` | No | none | Share token for the slides demo |

## Frontend: build environment

These configure the build itself and are never compiled into the bundle.

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `SENTRY_AUTH_TOKEN` | No | none | When set, the build emits source maps, uploads them to Sentry, and deletes them from `dist` |
| `SENTRY_ORG` | With the token | `wafflebase` | Sentry organization to upload to. Set your own |
| `SENTRY_PROJECT` | With the token | `wafflebase` | Sentry project to upload to. Set your own |

## Documentation site

| Variable | Required | Default | What it does |
|----------|----------|---------|--------------|
| `VITE_GA_ID` | No | none | Google Analytics for the docs pages built by `pnpm build:all`. Template: `packages/documentation/.env.production.example` |

## Related

- [Deploy to production](/developers/self-hosting/deploy) to apply these values.
- [Sign-in providers](/developers/self-hosting/sign-in) for the OAuth variables in context.
- [Optional features](/developers/self-hosting/optional-features) for analytics, lakehouse, error tracking, and templates.
- [`packages/backend/README.md`](https://github.com/wafflebase/wafflebase/blob/main/packages/backend/README.md) for the per-variable rationale.
