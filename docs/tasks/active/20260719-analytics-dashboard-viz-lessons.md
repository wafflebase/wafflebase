# Analytics Dashboard Visualization — Lessons

Running log of non-obvious findings and corrections for this task.

## Findings (from investigation)

- `viewsByDay` is computed by both the document and workspace query builders and
  returned in the API payload, but **never rendered** in v1 — the single biggest
  low-effort win. recharts (`^2.15.2`) is already a dependency.
- The API clients (`getDocumentAnalytics`, `getWorkspaceAnalytics`) already
  serialize `from`/`to`, but no UI ever passes a range → all views are all-time.
- `ShareLink` has no `name` column (id/token/role/documentId/createdBy/createdAt/
  expiresAt only) → label share links with role + created date + creator, no
  schema change.
- `avgDwell` averages per-session `MAX-MIN` timestamp over **all** event types, so
  open-only sessions contribute 0 and drag the average down.
- Tab names live in the Yorkie doc, not StarRocks — relevant only to the deferred
  Part B (tab breakdown), noted so it isn't re-discovered.

## Corrections

- **Document analytics had no global sidebar** because `/analytics/:id` was
  registered outside the `<Route element={<Layout />}>` block in `App.tsx`
  (only the workspace analytics route was inside). Fix: move it inside Layout +
  add a `ROUTE_TITLES` entry. `Layout` already tolerates a missing `workspaceId`
  (falls back to the first workspace's nav), so no extra plumbing is needed. This
  also made the standalone `navigate(-1)` Back button redundant, resolving the
  code-review "dead Back button on a fresh history stack" finding by removal.

- **Sidebar workspace switcher read "Select workspace" on Document Analytics.**
  `Layout` resolves `currentWorkspace` by matching the URL `:workspaceId`
  param; `/analytics/:id` has no such param, so `currentWorkspace` was
  `undefined` (nav items fell back to `workspaces[0]`, but the switcher showed no
  active workspace). Fix: nest the route as `/w/:workspaceId/analytics/:id` and
  pass `workspaceId` in the "Details" link, so Layout resolves the *document's*
  workspace. Lesson: any page that wants the workspace sidebar context must carry
  `:workspaceId` in its path — Layout has no other source of truth.
- **Redundant in-page `<h1>`** on both dashboards duplicated the `SiteHeader`
  title (once the pages live inside Layout). Dropped both; header shows the title.

## Code-review findings (high-effort workflow, all confirmed) & resolution

- **Share-link id dropped** — enriched label showed only role/creator/date, so
  two same-role/day/creator links were indistinguishable. Fixed: label keeps a
  `#<id8>` suffix.
- **Sparse-day trend interpolation** — warehouse `viewsByDay` omits zero-view
  days (`GROUP BY DATE`); a category axis collapses gaps into a smooth slope.
  Fixed: `densifyDaily` zero-fills interior days before charting.
- **UTC-vs-local window off-by-one** — kept UTC deliberately: the whole pipeline
  (event stamps, `DATE(timestamp)` bucketing) is UTC, so a local window would be
  *inconsistent* with the data; timezone-correct bucketing is a backend change
  out of scope. Documented rather than "fixed".
- **Duplicate `Stat`** — lifted to `app/analytics/stat.tsx`, imported by both.
- **Triplicated `{date,value}` type** — one exported `MetricSeriesPoint` in
  `api/analytics.ts`, reused by the workspace type and the chart.
