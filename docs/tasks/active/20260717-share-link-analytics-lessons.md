# Share Link Analytics — Lessons

Design: `docs/design/share-link-analytics.md`. Plan: `20260717-share-link-analytics-todo.md`.

## Context

Reuse Yorkie's existing Kafka + StarRocks OLAP stack (running in the
`analytics` k8s namespace) to collect share-link view statistics and surface a
per-document analytics dashboard to managers.

## Lessons (fill in during/after implementation)

- **StarRocks has no prepared statements.** All queries interpolate values as
  strings; the reference (`yorkie/server/backend/warehouse/starrocks.go`) does
  the same with `//nolint:gosec`. Mitigate by interpolating only server-derived
  ids and validated date ranges, and single-quote-escaping (`''`). Never
  interpolate raw client input.
- **The event granularity we want is frontend-only.** Dwell time and
  tab/slide navigation are invisible to Yorkie webhooks (Yorkie emits only
  `DocumentRootChanged`). Collection had to be a frontend beacon, not a
  backend webhook hook.
- **StarRocks reverses the storage instinct.** For an OLTP Postgres store a
  session table + rollup made sense; for a columnar OLAP engine the idiomatic
  shape is a single flat append-only event table with query-time aggregation.
- **Degrade to no-op.** Producer/warehouse both key off env vars so local
  `docker compose` (no Kafka/StarRocks) keeps working — mirrors Yorkie's
  `DummyWarehouse`. A malformed DSN must be caught in the constructor and
  leave the pool null (else a typo'd env var crashes the whole backend at
  Nest bootstrap).

## Discoveries during implementation (SDD run)

- **Task ordering had a forward reference.** The plan put the ingest
  controller (Task 3) before the warehouse service (Task 4), but the
  controller imports `AnalyticsWarehouseService`, so it can't compile until
  the warehouse exists. Executed Task 4 before Task 3.
- **Inclusive `to`-day date window (the one real bug the final review
  caught).** `timestamp < day(to)` truncates the upper bound to midnight, so
  a same-day dashboard load returns 0 views — the data is in StarRocks but
  the query never reaches it until the next UTC day. Fix: exclusive bound =
  `day(to) + 1 day`. Always test a same-day event is counted.
- **Producer reconnect wedge.** `this.connecting` must be reset to null when
  `connect()` rejects, or the first Kafka outage permanently wedges all
  future produces even after the broker recovers.
- **Reuse existing primitives.** An `OptionalJwtAuthGuard` already lived in
  `packages/backend/src/auth/`; the plan duplicated it. Reused the existing
  one (repo's single-source convention, cf. `document-access.ts`).
- **Prettier 80-col on plan-verbatim code.** Test snippets copied from the
  plan can exceed printWidth and fail the `verify:fast` eslint gate — run
  `eslint --fix` on new files before committing.
- **Accepted v1 limitations** (documented in the PR): dev-only React
  StrictMode can double-emit `open` (production has no StrictMode); no nav
  entry to `/analytics/:id` yet (URL-reachable, manager-gated server-side);
  the per-tab/slide `byTarget` breakdown stays empty until `activeTabId` is
  threaded into `useViewAnalytics` (section is hidden while empty).
