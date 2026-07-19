# Analytics Dashboard Visualization (v2)

Design: `docs/design/share-link-analytics.md` → "Dashboard Visualization (v2)".

Improve the Share-Link analytics dashboards (per-document + workspace) so they
actually render the metrics the backend already computes. **Presentation only** —
no new events, no new warehouse columns. Part B (tab/slide breakdown) is deferred.

## Scope

- Render `viewsByDay` (computed today, never shown) as a trend chart on both dashboards.
- Add a date-range picker (presets) wired into `from`/`to` (API already supports it).
- Polish tables/stats: dwell `2m 03s`, returning %, share-link labels (role+date+creator).
- Fix the `avgDwell` bug (single-event sessions drag the average to 0).
- Fix the stranded `/analytics/:id` page (no back-nav outside `<Layout>`).

## Plan

### Backend
- [x] `avgDwell` fix in `analytics-warehouse.service.ts` `buildQueries.dwell` — add
      `HAVING COUNT(*) > 1` to the per-session subquery so open-only sessions are excluded.
- [x] Share-link enrichment in `analytics.controller.ts` `getDocumentAnalytics`:
      after warehouse returns `byShareLink`, resolve `role` / `createdAt` / creator
      from Postgres (mirror the workspace `byDocument` title-resolution pattern).
      Extend the `byShareLink` response item shape accordingly.
- [x] Unit tests: dwell query excludes single-event sessions; share-link enrichment maps ids → metadata.

### Frontend — shared module `src/app/analytics/`
- [x] `ViewsTrendChart` (recharts area over `{date,value}[]`, empty-state guard).
- [x] `DateRangePicker` (presets: 7/30/90 days + All time → `{from,to}`; default 30d).
      Split into `date-range.tsx` (component) + `presets.ts` (logic) for react-refresh lint.
- [x] Formatters: `formatDwell(seconds) → "2m 03s"`, `returningRate(returning, unique) → %`.
- [x] Component tests: chart empty state + mount smoke, dwell/rate formatting, preset range math.

### Frontend — per-document (`document-analytics.tsx`)
- [x] Mount trend chart above stat tiles; wire date-range into `useQuery` key + `getDocumentAnalytics`.
- [x] Dwell tile → `formatDwell`; returning tile → count + %.
- [x] Share-link table → role + created date + creator (from enriched payload); shared `Table` UI.
- [x] Fix missing global sidebar: move `/analytics/:id` inside the `<Layout>` route
      block in `App.tsx` + add `ROUTE_TITLES` entry (Layout tolerates no workspaceId).
      Supersedes the standalone Back button.

### Frontend — workspace (`workspace-analytics.tsx`)
- [x] Mount trend chart; wire date-range into `useQuery` key + `getWorkspaceAnalytics`.
- [x] Apply shared `Table` UI to ranking table for consistency.

### Types
- [x] Update `DocumentAnalytics.byShareLink` type (frontend `api/analytics.ts`) to
      carry `role` / `createdAt` / `creator`; backend `ShareLinkBreakdown` in sync.

## Verification
- [x] `pnpm verify:fast` green (EXIT=0).
- [x] Frontend `build` green; analytics chunks emit.
- [ ] Manual smoke in `pnpm dev` with the `analytics` docker profile: open a doc via
      share link to emit events, confirm trend chart + date range + dwell/returning render.
- [x] Self code-review over the branch diff (high-effort workflow): 6 confirmed
      findings, all resolved (5 fixed, 1 UTC documented as deliberate). See lessons.
- [ ] Manual live smoke needs the running app + login (analytics stack for data).

## Review

_(fill in after implementation)_
