---
title: share-link-analytics
target-version: 0.7.0
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# Share Link Analytics

## Summary

Collect view statistics from documents opened through a **Share Link** and
surface per-document **Analytics** to document managers. Reuse the existing
Yorkie **OLAP stack** (Kafka + StarRocks, running in the `analytics`
Kubernetes namespace) rather than building a new store: the Wafflebase
backend produces view events to a Kafka topic, a StarRocks **Routine Load**
job ingests them into a single flat append-only table, and the backend
queries StarRocks (MySQL protocol) to render a document Analytics dashboard.

The reference implementation is Yorkie's own MAU pipeline (in the `yorkie`
repo: server/backend/messaging/kafka.go, server/backend/warehouse/starrocks.go,
build/docker/analytics init SQL, and docs/design/olap-stack.md). This design
ports that Go pattern to the Wafflebase NestJS backend.

### Goals

- Count views of share-linked documents: total views, unique visitors,
  returning visitors, average dwell time.
- Attribute views per **Share Link** so managers can compare links
  (e.g. marketing link vs. customer link).
- Break engagement down by **tab / sheet / slide** to reveal which parts
  are viewed and where viewers drop off.
- Identify returning **anonymous** visitors via an opaque visitor id, and
  show **logged-in** viewers by name.
- Reuse the existing `analytics`-namespace Kafka + StarRocks cluster; no new
  datastore, no new infra component types.
- Degrade safely: with Kafka/StarRocks unconfigured (local `docker compose`),
  event production is a no-op and the dashboard reports "analytics disabled" —
  the app keeps working.

### Non-Goals

- **Owner / direct edit views** (`/d /s /p /f /n /:id` routes) are out of
  scope for v1. Only share-link access is instrumented. Owner-view
  instrumentation is a future extension.
- **Cell / range / scroll-heatmap** granularity. v1 stops at
  tab/sheet/slide level.
- **Raw IP retention.** No client IP is stored; only a coarse user-agent
  string. Visitor identity is an opaque random id, not PII.
- **Real-time streaming dashboard.** Routine Load ingestion is near-real-time
  (seconds), and the dashboard queries on load; no websocket push.
- **Cross-product data mixing.** Wafflebase data lands in a dedicated
  `wafflebase` StarRocks database, separate from Yorkie's `yorkie` database.

## Proposal Details

### Architecture

```
Frontend  packages/frontend/src/app/shared/shared-document.tsx
  │  emits: open | heartbeat(30s) | tabchange | close(navigator.sendBeacon)
  ▼
POST /internal/analytics/view-events        NestJS AnalyticsModule (new)
  │  kafkajs producer (async, fire-and-forget)   ← ports messaging/kafka.go
  ▼
Kafka topic: wafflebase-view-events         existing analytics-ns Kafka
  │  StarRocks Routine Load (JSON)               ← devops init SQL + watcher
  ▼
StarRocks table: wafflebase.view_events     single flat DUPLICATE KEY table
  ▲  mysql2 string-interpolated query            ← ports warehouse/starrocks.go
  │
GET /documents/:id/analytics                manager-gated read endpoint
  ▼
Analytics dashboard page                    per-document metrics UI
```

Why a **single flat event table** (not the session+event split used for an
OLTP Postgres store): StarRocks is a columnar OLAP engine with `DUPLICATE KEY`
append-only tables. The idiomatic pattern — the one Yorkie already uses — is
one flat event table per event class and **compute aggregates at query time**.
Dwell time is `max(timestamp) - min(timestamp)` grouped by `session_id`;
tab/slide breakdown is `GROUP BY target`. No session table, no rollup job.

### Event schema

Frontend emits JSON events; the backend enriches (share link id, resolved
user id) and produces to Kafka. StarRocks `wafflebase.view_events`:

| Column          | Type          | Notes                                              |
| --------------- | ------------- | -------------------------------------------------- |
| `document_id`   | VARCHAR(64)   | Wafflebase `Document.id`                           |
| `share_link_id` | VARCHAR(64)   | Attribution; empty for non-share access (future)   |
| `session_id`    | VARCHAR(64)   | One browser visit; groups events for dwell         |
| `visitor_id`    | VARCHAR(64)   | Opaque localStorage UUID; returning-visitor id     |
| `user_id`       | VARCHAR(64)   | Logged-in viewer (`sub`); empty for anonymous      |
| `role`          | VARCHAR(16)   | `viewer` \| `editor` (from resolved share link)    |
| `event_type`    | VARCHAR(32)   | `open` \| `heartbeat` \| `tabchange` \| `close`    |
| `target`        | VARCHAR(128)  | tab id / sheet id / slide index being viewed       |
| `doc_type`      | VARCHAR(16)   | `spreadsheet` \| `docs` \| `slides` \| `pdf` \| `note` |
| `user_agent`    | VARCHAR(64)   | Coarse UA (browser/OS family); no full UA, no IP   |
| `timestamp`     | DATETIME      | Event time (server-stamped on ingest)              |

```sql
-- devops: k8s init (new `wafflebase` database in the same StarRocks cluster)
CREATE DATABASE IF NOT EXISTS wafflebase;
USE wafflebase;
CREATE TABLE IF NOT EXISTS view_events (
    document_id   VARCHAR(64),
    share_link_id VARCHAR(64),
    session_id    VARCHAR(64),
    visitor_id    VARCHAR(64),
    user_id       VARCHAR(64),
    role          VARCHAR(16),
    event_type    VARCHAR(32),
    target        VARCHAR(128),
    doc_type      VARCHAR(16),
    user_agent    VARCHAR(64),
    timestamp     DATETIME
) ENGINE = OLAP
DUPLICATE KEY(document_id, session_id, timestamp)
DISTRIBUTED BY HASH(document_id) BUCKETS 16
PROPERTIES ("replication_num" = "1");

CREATE ROUTINE LOAD wafflebase.view_events ON view_events
PROPERTIES ("format" = "JSON", "desired_concurrent_number" = "1")
FROM KAFKA (
    "kafka_broker_list" = "yorkie-analytics-kafka.analytics.svc.cluster.local:9092",
    "kafka_topic" = "wafflebase-view-events",
    "property.group.id" = "wafflebase_view_events_group"
);
```

### Backend: `AnalyticsModule` (NestJS)

New module mirroring `ApiKeyModule` / `ShareLinkModule` (controller + service +
`PrismaService`, registered in `packages/backend/src/app.module.ts`). New dependencies: `kafkajs`
(producer) and `mysql2` (StarRocks reader).

- **`AnalyticsProducerService`** — wraps a `kafkajs` producer, `send()` to
  `wafflebase-view-events`, fire-and-forget with error logging. Ports
  `messaging/kafka.go` (async, non-blocking; a failed produce never breaks a
  view). No-op when `WAFFLEBASE_KAFKA_ADDRESSES` is unset.
- **`AnalyticsWarehouseService`** — wraps a `mysql2` pool to StarRocks FE
  `9030`, database `wafflebase`. Ports `warehouse/starrocks.go`: **string
  interpolation, not prepared statements** (StarRocks lacks prepared-stmt
  support — see the `//nolint:gosec` notes in the reference). All interpolated
  inputs are server-derived ids / validated date ranges, never raw client
  strings. Returns metric series + counts. No-op → "disabled" when
  `WAFFLEBASE_STARROCKS_DSN` is unset.
- **Controller endpoints**:
  - `POST /internal/analytics/view-events` — accepts a batch of client events,
    resolves `share_link_id` / `user_id` / `role` from the request context
    (share token + optional session cookie), enriches, produces to Kafka.
    `@SkipThrottle()`-style light path; validates document/share-link exists.
  - `GET /documents/:id/analytics?from=&to=` — **manager-gated**
    (`isDocumentManager`, reusing `packages/backend/src/document/document-access.ts`). Queries StarRocks and
    returns the dashboard payload.

Config additions (backend `.env`, documented in README):

```env
WAFFLEBASE_KAFKA_ADDRESSES=yorkie-analytics-kafka.analytics.svc.cluster.local:9092
WAFFLEBASE_KAFKA_TOPIC=wafflebase-view-events
WAFFLEBASE_STARROCKS_DSN=root:@tcp(kube-starrocks-fe-search.analytics.svc.cluster.local:9030)/wafflebase
```

### Frontend: beacon + dashboard

- **Beacon hook** in `packages/frontend/src/app/shared/shared-document.tsx` (the `/shared/:token` route, which
  already knows `resolved.role`, the share `token`, `doc.type`, and
  `activeTabId`):
  - On mount: generate/read `visitor_id` from `localStorage`, generate a
    per-visit `session_id`, POST an `open` event.
  - Every 30s while visible (Page Visibility API): `heartbeat`.
  - On `activeTabId` change: `tabchange` with the new tab as `target`.
    Slide-level `target` uses an optional callback surfaced from `SlidesView`;
    if not wired, slides fall back to tab-level granularity.
  - On unload / route change: `close` via `navigator.sendBeacon` (survives
    page teardown).
  - Events are batched and sent to `POST /internal/analytics/view-events`.
- **Dashboard** — a per-document Analytics page (linked from the document
  context menu / share dialog for managers) rendering: total & unique views,
  returning visitors, average dwell, a per-share-link comparison table, and a
  per-tab/slide engagement breakdown, over a selectable date range.

### DevOps (separate repo: `yorkie-team/devops`)

Physically separate from the Wafflebase PR. Landed as the prerequisite infra
change for this feature:

- New `wafflebase` StarRocks database + `view_events` table + Routine Load
  (SQL above), added to the analytics init path.
- The StarRocks routine-load watcher CronJob (devops
  k8s/cluster/starrocks-routine-load-watcher.yaml): add a `wafflebase` DB
  block (or extend the loop) so `wafflebase.view_events` auto-resumes when
  PAUSED, alongside the existing `yorkie` jobs.
- The Wafflebase deployment manifest (devops k8s/wafflebase/deployment.yaml):
  inject `WAFFLEBASE_KAFKA_ADDRESSES`, `WAFFLEBASE_KAFKA_TOPIC`,
  `WAFFLEBASE_STARROCKS_DSN` env.

### Local development

Kafka/StarRocks are **not** part of the Wafflebase `docker compose` by default.
With the two env vars unset, the producer and warehouse services no-op and the
dashboard shows "analytics disabled" (mirrors Yorkie's `DummyWarehouse`).
Integration testing can reuse Yorkie's analytics docker-compose stack
(yorkie repo: build/docker/analytics — StarRocks FE/BE + Kafka + init).

### Privacy

- `visitor_id` is an opaque random UUID in `localStorage`, used only for
  returning-visitor counting; it is not linked to any identity.
- Logged-in viewers store `user_id` (`sub`) so managers see real names; this is
  the same identity already exposed to collaborators via presence.
- No raw IP is stored. `user_agent` is reduced to a browser/OS family string.
- Follows the privacy stance of Yorkie's OLAP design (yorkie repo:
  docs/design/olap-stack.md — hash/opaque identifiers, no raw PII in the
  warehouse).

### Risks and Mitigation

- **Cross-namespace reachability** — the `wafflebase` namespace must resolve
  `*.analytics.svc.cluster.local`. Same-cluster DNS works today (no
  NetworkPolicy isolating `analytics`); verify in shadow rollout.
- **Routine Load pausing** — StarRocks Routine Loads can PAUSE on BE restart;
  the existing watcher CronJob already auto-resumes. Extend it to cover
  `wafflebase` so ingestion self-heals.
- **SQL string interpolation** — required (no prepared statements in
  StarRocks). Mitigate by interpolating only server-derived ids and
  server-validated date ranges; never interpolate raw client input.
- **Event loss** — the producer is async fire-and-forget; a Kafka outage drops
  events but never blocks a view. Acceptable for analytics (not billing).
- **Beacon reliability** — `close` uses `navigator.sendBeacon`; dwell is
  computed from `max-min` timestamps so a lost `close` still yields dwell from
  the last `heartbeat`.
