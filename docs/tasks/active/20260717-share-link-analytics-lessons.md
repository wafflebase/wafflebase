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
  ids and validated date ranges, and single-quote-escaping (`'' `). Never
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
  `DummyWarehouse`.
- _(add discoveries as they surface)_
