# History: page the version list instead of silently capping at 50

Issue: #1092 (follow-up to #1010)

## Problem

`useRevisionHistory` asks `listRevisions({ pageSize: 50 })` once and never
asks again. A document with more than 50 revisions shows only the newest 50,
with no "load more" affordance and no hint that anything is missing — and the
oldest versions are usually the ones worth restoring. Recorded as a known gap
in `docs/design/revision-history.md` §3 / Risks.

## Approach

`listRevisions` accepts `offset` (SDK 0.7.23+, we are on 0.7.25), so:

- Keep the flat `RevisionSummary[]` in hook state and derive `days` from it,
  so a second page can be appended without re-grouping by hand.
- Ask for `pageSize + 1` and drop the extra entry: its presence is the
  "more exist" signal the RPC does not otherwise give us.
- `loadMore()` fetches at `offset = loaded.length` and appends, **deduped by
  revision id** — revisions created between page loads shift every offset.
- Panel renders a "Load older versions" button at the end of the timeline
  while `hasMore`.

## Checklist

- [ ] `use-revision-history.ts`: flat revision state, `hasMore`,
      `isLoadingMore`, `loadMore()`; `refresh()` resets to the first page.
- [ ] Generation guard covers `loadMore` too — a refresh that lands first
      must invalidate an append computed against the old list.
- [ ] A second `loadMore` while one is in flight is refused (same offset
      twice would duplicate work).
- [ ] `loadMore` rejects on failure and leaves `days` / `error` alone; the
      panel reports it beside the button, the way it already reports naming
      and restore failures.
- [ ] `history-panel.tsx`: "Load older versions" button + its error line.
- [ ] Unit tests: probe entry dropped, offset paging, dedupe, stale append
      ignored, concurrent clicks, failure reported.
- [ ] `docs/design/revision-history.md`: §3 "There is no paging" paragraph,
      §7 rollout row, and the Risks note that calls the cap a symptom.

## Non-goals

Retention/deletion of revisions (unbounded storage is a separate risk),
infinite scroll, and changing the page size.
