---
title: documents-last-modified
target-version: 0.5.0
---

# Documents List — Last-Modified Ordering

## Summary

The documents list orders by "last modified". Content edits, however, flow
**client → Yorkie only** — the NestJS backend is not on the edit path, so
Postgres has no edit signal (`Document` historically had `createdAt` only).

The list previously synthesized `updatedAt` per request from Yorkie's admin
`GetDocuments` call. That call is slow and variable (authenticated presence
query against a sharded MongoDB) and straddles the backend's 800 ms timeout,
so `updatedAt` flipped between the real Yorkie value and a `createdAt`
fallback on each 5 s poll — the list visibly reshuffled. (Confirmed on the
live cluster: gateway RTT ~25 ms, but the admin query timed out ~every poll.)

This design moves last-modified into a stable Postgres column fed by Yorkie's
**event webhook**, and demotes the admin call to editor-avatars only.

## Goals / Non-Goals

**Goals**
- Stable documents-list ordering that still reflects real edit recency.
- No per-request dependency on the flaky Yorkie admin call for ordering.

**Non-Goals**
- Self-healing missed webhooks (backend down mid-edit) — accept small
  staleness; a periodic Yorkie→PG sync can be layered later.
- Fixing the underlying Yorkie admin-query latency (separate concern; the
  "currently editing" avatars remain best-effort over it).

## Proposal Details

### Data model
`Document.updatedAt DateTime @default(now())` — set **explicitly** (not
Prisma `@updatedAt`). Migration backfills existing rows `= createdAt`. List
endpoints order by `[{ updatedAt: desc }, { createdAt: desc }]`.

### Ingestion — Yorkie event webhook (yorkie 0.7.12)
- Event `DocumentRootChanged`, fired on real root-content operations (not
  presence/attach/watch).
- Body: `{ type, attributes: { key: "<type>-<id>", issuedAt } }`.
- Auth: `X-Signature-256: sha256=<hex>`, `HMAC-SHA256(rawBody, project.SecretKey)`.
  The signing key **is** the project secret key, already held by the backend
  as `YORKIE_SECRET_KEY` — no new secret. Raw request bytes are captured via a
  `bodyParser.json({ verify })` hook (HMAC must run over exact bytes).
- Endpoint `POST /internal/yorkie/events` — no JWT, `YorkieSignatureGuard`,
  `@SkipThrottle`. Parses the key (`parseYorkieDocKey`), then
  `DocumentService.touchUpdatedAt(id, issuedAt)`.
- Delivery is at-least-once, unordered, retried → `touchUpdatedAt` is
  **monotonic** (`updateMany where updatedAt < at`) and idempotent; unknown
  keys / other events / missing docs are 200-swallowed so Yorkie won't retry.

### Read path
`attachMeta` sources `updatedAt` from the DB column and uses
`YorkieAdminService.getEditors` purely for the avatars. The frontend keeps its
`updatedAt desc` default sort, which is now stable because the value is.

### Ops
Register the webhook on the Yorkie project (internal cluster URL, no public
exposure):

```
yorkie project update <project> \
  --event-webhook-url http://wafflebase.wafflebase.svc.cluster.local:3000/internal/yorkie/events \
  --event-webhook-events DocumentRootChanged
```

## Risks and Mitigation

- **Duplicate / out-of-order events** → monotonic advance-only update absorbs.
- **Missed webhook** (backend down) → `updatedAt` slightly stale; acceptable,
  future periodic sync self-heals.
- **Forged requests** → HMAC signature verification is mandatory; the endpoint
  refuses to run when `YORKIE_SECRET_KEY` is unset.
- **`pdf` documents** have no CRDT edits → no webhook → stay at `createdAt`,
  which is correct.
