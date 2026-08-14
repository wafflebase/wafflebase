# Storage key prefix for shared buckets — todo

PR: [#720](https://github.com/wafflebase/wafflebase/pull/720)
Design: [`docs/design/pdf.md`](../../design/pdf.md) (file storage section)

## Goal

Let a deployment namespace its S3 objects inside a bucket **shared with
another app**. Our internal S3 platform (Nubes) won't provision a dedicated
bucket for a new self-hosted deployment, so `FileService` (bare-UUID keys) and
`ImageService` (per-call `keyPrefix` only) would otherwise write to the bucket
root, intermixed with the other app's objects.

## Implementation

- [x] `FILE_STORAGE_PREFIX` / `IMAGE_STORAGE_PREFIX` env vars, default `""`
- [x] Private `storageKey()` on both services, applied on `put`/`get`/`delete`
- [x] Returned `id` (and `Document.fileId`) stays **bare** — prefix is a
      storage-layout concern only, so no schema or API change
- [x] Image config prefix composes **outside** the per-call `keyPrefix`
      (`wafflebase/<workspaceId>/<id>`)
- [x] Unit tests for both services (`file.service.spec.ts`,
      `image.service.spec.ts`)

## Review follow-ups (CodeRabbit, 2026-08-07)

- [x] Trim surrounding `/` when loading the prefix, so `wafflebase/` and
      `/wafflebase/` don't produce an empty key segment (`wafflebase//<id>`).
      Normalized in the service constructor (not the config module) so the
      existing mock-`ConfigService` spec harness covers it.
- [x] Document the prefix's immutability in `docs/design/pdf.md` + both
      `storageKey()` doc comments. **Rejected** the suggested legacy-key
      fallback: a prefix is a storage-layout setting like the bucket and
      endpoint beside it, neither of which has a fallback read; dual-read
      would double S3 round-trips on every miss and still can't be correct
      across an unbounded prefix history.
- [x] Assert `get`/`delete` (not just `put`) in the empty-prefix tests — the
      same gap existed in `file.service.spec.ts`, so both were filled.
- ~ESLint not covering the image files~ — **invalid**, tooling artifact.
      CodeRabbit ran `npx eslint` from the repo root, whose flat config
      doesn't include `packages/backend`; the backend has its own
      `eslint.config.mjs` + `lint:check`, under which all four touched files
      lint clean.

Found in review, not flagged by CodeRabbit:

- [x] Restore the `// eslint-disable-next-line no-console` that the branch
      accidentally deleted in `image.service.ts` (left a stray blank line;
      harmless since `no-console` isn't enabled, but unrelated to this PR)
- [x] `IMAGE_STORAGE_PREFIX` shipped undocumented while `FILE_STORAGE_PREFIX`
      got a `pdf.md` line — both now in the `packages/backend/README.md` env
      block

## Verification

- [x] `pnpm verify:fast`
- [x] CI `verify:self` + `verify:integration`
