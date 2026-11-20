---
title: Troubleshooting
description: Fix common startup, sign-in, sync, upload, and feature errors on a self-hosted Wafflebase.
type: troubleshooting
---

# Troubleshooting

Fix the errors operators most often see when running Wafflebase themselves. Find the message or symptom, then try the fixes in order.

## `JWT_SECRET is required`

**What it means:** The backend exits at startup because `JWT_SECRET` is not set.

**Try this:**

1. Set `JWT_SECRET` in `packages/backend/.env` or the container environment.
2. Restart the backend.

## The backend fails with `OAuth2Strategy requires a clientID option`

**What it means:** GitHub sign-in is always on, and `GITHUB_CLIENT_ID` is missing.

**Try this:**

1. Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `GITHUB_CALLBACK_URL`. See [Set up GitHub sign-in](/developers/self-hosting/sign-in#set-up-github-sign-in).
2. Restart the backend.

## The app loads but sign-in and sync fail for everyone else

**What it means:** The frontend was built without your URLs, so browsers call `http://localhost:3000` and `http://localhost:8080` on their own machines.

**Try this:**

1. Search the app build for `localhost:3000`: `grep -rl --exclude-dir=docs 'localhost:3000' packages/frontend/dist`. Any result means the build used the defaults.
2. Set `VITE_BACKEND_API_URL` and `VITE_YORKIE_RPC_ADDR` in `packages/frontend/.env.production.local` or on the build command. Do not use `.env.local`.
3. Rebuild and redeploy. See [Build the frontend](/developers/self-hosting/deploy#build-the-frontend).

## Sign-in returns to the login page with "That sign-in link expired"

**What it means:** The browser dropped the sign-in state cookie. The usual cause is a `Secure` cookie on a plain-`http` origin, or sign-in started in another tab.

**Try this:**

1. Sign in again from a single tab.
2. Check that `GITHUB_CALLBACK_URL` uses the scheme users actually reach. On plain `http`, it must start with `http://`.
3. If you set `COOKIE_SECURE=true`, make sure the site really is served over `https`.
4. Check that `FRONTEND_URL` matches the frontend origin exactly.

## The log says session cookies are issued without `Secure`

**What it means:** `NODE_ENV=production` with an `http://`, non-loopback `GITHUB_CALLBACK_URL`. Session cookies go out unprotected.

**Try this:**

1. Set `GITHUB_CALLBACK_URL` to the `https://` URL users reach.
2. If TLS ends at a proxy and you cannot change the URL, set `COOKIE_SECURE=true`.

## `Command-line sign-in requires an https server`

**What it means:** `wafflebase login` is refused because the backend cannot tell it is served over HTTPS.

**Try this:**

1. Set `GITHUB_CALLBACK_URL` to an `https://` URL, or set `COOKIE_SECURE=true` behind a TLS proxy.
2. Or sign the CLI in with an API key instead. See [CLI](/developers/cli/).

## GitHub Enterprise sign-in fails with `Bad credentials`

**What it means:** The email lookup went to github.com instead of your instance.

**Try this:**

1. Set all four GitHub Enterprise URLs, including `GITHUB_USER_EMAIL_URL`. See [Use GitHub Enterprise](/developers/self-hosting/sign-in#use-github-enterprise).
2. Restart the backend.

## The Google button does not appear

**What it means:** Google sign-in needs all three `GOOGLE_*` variables. The backend logs `Google sign-in is disabled:` with the missing names.

**Try this:**

1. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CALLBACK_URL`.
2. Restart the backend and reload the sign-in page.

## Google sign-in fails with `redirect_uri_mismatch`

**What it means:** `GOOGLE_CALLBACK_URL` does not exactly match an authorized redirect URI on the Google OAuth client.

**Try this:**

1. Copy `GOOGLE_CALLBACK_URL` into the client's authorized redirect URIs, including scheme and path.
2. Try again after Google saves the change.

## Uploads fail on a new deployment

**What it means:** With `NODE_ENV=production`, storage has no defaults, so the backend has no endpoint, bucket, or keys. The startup log shows a bucket warning.

**Try this:**

1. Set all five `FILE_STORAGE_*` and all five `IMAGE_STORAGE_*` connection variables. See [Set up blob storage](/developers/self-hosting/deploy#set-up-blob-storage).
2. Create the buckets, or give the credentials `s3:CreateBucket`.
3. Restart the backend and check the log for bucket warnings.

## Large uploads fail with `413` or `File too large`

**What it means:** The file is over the limit (100 MB for files, 25 MB for image files, 10 MB for images inserted in documents), or your proxy's body limit is lower. The backend answers `413`, or `400 File too large (max 25 MB)` for an image file between 25 MB and 100 MB.

**Try this:**

1. Check the file size against [the limits](/developers/self-hosting/deploy#set-up-blob-storage).
2. Raise your proxy's request body limit to at least 100 MB.
3. For large imports through the API with inline images, raise `BACKEND_JSON_BODY_LIMIT`.

## Saving a database connection fails with a server error

**What it means:** `DATASOURCE_ENCRYPTION_KEY` is missing or invalid. The backend log shows `DATASOURCE_ENCRYPTION_KEY environment variable is required`, or `DATASOURCE_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)` when it has the wrong length or characters. The rest of the app works.

**Try this:**

1. Generate a key with `openssl rand -hex 32` and set it.
2. Restart the backend.

## Lakehouse reads fail on a server without internet access

**What it means:** DuckDB could not download an extension.

**Try this:**

1. Use the production image, which already contains the extensions.
2. Or copy the extensions to a directory and set `LAKEHOUSE_DUCKDB_EXTENSION_DIR`. See [Run the lakehouse without internet access](/developers/self-hosting/optional-features#run-the-lakehouse-without-internet-access).

## A lakehouse connection says the endpoint `is not allowed by the server`

**What it means:** The custom endpoint or catalog is not in `LAKEHOUSE_ALLOWED_ENDPOINTS`.

**Try this:**

1. Add the exact origin, for example `https://s3.example.com`, to `LAKEHOUSE_ALLOWED_ENDPOINTS`.
2. Restart the backend.

## The log says `SHADOW mode`

**What it means:** `YORKIE_AUTH_WEBHOOK_ENFORCE=false` is set. Access decisions are logged but every request is allowed.

**Try this:**

1. Unset `YORKIE_AUTH_WEBHOOK_ENFORCE`.
2. Restart the backend and check for `enforcing per-document access` in the log.

## Viewers can edit documents

**What it means:** The Yorkie auth webhook is not registered, or the backend is in shadow mode.

**Try this:**

1. Register the webhook methods. See [Turn on per-document access control](/developers/self-hosting/deploy#turn-on-per-document-access-control).
2. Make sure `YORKIE_SECRET_KEY` is set and the log does not say `SHADOW mode`.

## Naming a version fails for everyone

**What it means:** `CreateRevision` is registered on the Yorkie auth webhook.

**Try this:**

1. Remove it: `yorkie project update <project> --auth-webhook-method-rm CreateRevision`.

## The documents list does not sort by last edit

**What it means:** The Yorkie event webhook is not registered, or `YORKIE_SECRET_KEY` is missing and the backend refuses it.

**Try this:**

1. Set `YORKIE_SECRET_KEY`.
2. Register the event webhook. See [Keep the documents list in edit order](/developers/self-hosting/deploy#keep-the-documents-list-in-edit-order).

## The public template gallery stays closed

**What it means:** Submitting to the public gallery needs reviewers and `YORKIE_AUTH_WEBHOOK_ENFORCE=true`.

**Try this:**

1. Set `WAFFLEBASE_TEMPLATE_REVIEWER_IDS` to at least one user ID.
2. Set `YORKIE_AUTH_WEBHOOK_ENFORCE=true` exactly.
3. Restart the backend. See [Open the public template gallery](/developers/self-hosting/optional-features#open-the-public-template-gallery).

## Still stuck

Check the backend log for the first error after startup, then search or open an issue on [GitHub](https://github.com/wafflebase/wafflebase/issues). Include the message, your deployment method, and which optional features you turned on.

## Related

- [Configuration](/developers/self-hosting/configuration) for every variable and its default.
- [Deploy to production](/developers/self-hosting/deploy) for the full setup.
- [Sign-in providers](/developers/self-hosting/sign-in) for OAuth and cookie setup.
