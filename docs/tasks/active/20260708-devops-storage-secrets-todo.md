# Move blob-store credentials out of the devops manifest into a k8s Secret

**Repo:** `yorkie-team/devops` (not this repo) — tracked here because it is
follow-up debt surfaced during the v0.5.0 release (see
`20260707-release-v0.5.0-todo.md`).

## Problem

`k8s/wafflebase/deployment.yaml` stores the AWS S3 credentials **inline in
plaintext** as container env values:

- `IMAGE_STORAGE_ACCESS_KEY` / `IMAGE_STORAGE_SECRET_KEY` — pre-existing.
- `FILE_STORAGE_ACCESS_KEY` / `FILE_STORAGE_SECRET_KEY` — added in the
  v0.5.0 bump (devops PR #324) for the PDF viewer blob store, reusing the
  same S3 bucket + credentials as the image store.

Committing live IAM keys to the repo is a real leak risk (the auto-mode
credential classifier flagged it during the v0.5.0 bump). The same values
also appear for `GITHUB_CLIENT_SECRET`, `JWT_SECRET`,
`DATASOURCE_ENCRYPTION_KEY`, and `YORKIE_SECRET_KEY` — the whole secret
surface of the deployment is plaintext, so this is broader than just the
storage keys.

## Goal

Move secret env values to a k8s `Secret` and reference them via
`valueFrom.secretKeyRef`, so the manifest in git contains **no** live
credentials. Non-secret config (endpoints, buckets, regions, URLs) can stay
inline or move to a `ConfigMap`.

## Approach (single devops PR)

- [ ] Create a `Secret` (e.g. `wafflebase-secrets`, namespace `wafflebase`)
      holding: `IMAGE_STORAGE_ACCESS_KEY`, `IMAGE_STORAGE_SECRET_KEY`,
      `FILE_STORAGE_ACCESS_KEY`, `FILE_STORAGE_SECRET_KEY`,
      `GITHUB_CLIENT_SECRET`, `JWT_SECRET`, `DATASOURCE_ENCRYPTION_KEY`,
      `YORKIE_SECRET_KEY`. Decide provisioning: `kubectl create secret`
      out-of-band vs. Sealed Secrets / SOPS / External Secrets so the
      encrypted form *can* live in git.
- [ ] Rewrite `deployment.yaml` env entries for those keys to
      `valueFrom.secretKeyRef: { name: wafflebase-secrets, key: ... }`.
      Keep `*_ENDPOINT` / `*_BUCKET` / `*_REGION` and public URLs inline.
- [ ] `kubectl apply --dry-run=client` (or `kustomize build | kubeconform`)
      passes; confirm the pod still resolves all env at runtime.
- [ ] **Rotate the exposed keys** — the AWS IAM key + the other secrets have
      been in git history in plaintext; moving them to a Secret does not
      un-leak the old values. Rotate and scrub, or accept the risk explicitly.

## Notes

- `FILE_STORAGE_*` and `IMAGE_STORAGE_*` intentionally share one S3 bucket
  (`wafflebase`) and one IAM key — PDFs use `<uuid>.pdf` keys, images use
  their own, so no collision. A single Secret entry per credential is enough.
- Scope check: don't expand into re-architecting IAM (per-service keys,
  least-privilege bucket policies) in this PR — capture that separately if
  wanted.

## Review

_(fill in after the devops PR lands)_
