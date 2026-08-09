# Analytics "Details" link 403s for non-manager members (#732)

## Problem

`GET /workspaces/:wid/analytics` is member-gated, but
`GET /documents/:id/analytics` is manager-gated (`isDocumentManager` —
workspace owner or document author). The workspace analytics ranking
renders a "Details" link on every row, so a plain member clicking a
document someone else authored lands on a page that 403s and shows the
generic "Failed to load analytics."

## Approach

1. **Backend** — annotate each workspace ranking row with `canManage`, the
   same predicate the detail endpoint enforces (`isDocumentManager`),
   computed from the caller's workspace role + the document's `authorID`.
   Mirrors how the documents list already annotates rows.
2. **Frontend (primary)** — render the "Details" link only when
   `row.canManage`; other rows show nothing in that cell.
3. **Frontend (safety net)** — a deep-linked / stale-tab 403 on the
   per-document page renders a permission-specific message instead of the
   generic failure text.

## Checklist

- [x] `DocumentBreakdown` gains `canManage: boolean` (backend types +
      warehouse placeholder + frontend `WorkspaceAnalytics` type).
- [x] `workspaceDashboard` selects `authorID` and fills `canManage` from
      the caller's membership role.
- [x] Workspace analytics table hides "Details" for non-manageable rows.
- [x] Document analytics page distinguishes 403 from other errors.
- [x] Backend unit test: manager vs non-manager rows in the ranking.
- [x] Design doc note in `docs/design/share-link-analytics.md`.

## Out of scope

- Loosening the detail endpoint's manager gate (the gate is intended).
- Any change to the event ingest / warehouse queries.
