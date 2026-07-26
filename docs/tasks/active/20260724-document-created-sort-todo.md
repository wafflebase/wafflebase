# Add "Created" date column for document sorting (issue #541)

## Problem

The documents list only lets users sort by **Modified** time. Users who
remember only when a document was originally created can't order the list by
creation date, hurting discoverability.

## Goal

Add a sortable **Created** column to the documents list, next to **Modified**,
backed by the `Document.createdAt` value the frontend already receives.

## Approach

- The list is a `@tanstack/react-table` in
  `packages/frontend/src/app/documents/document-list.tsx`. A reusable
  `dateColumn(id, label, accessor)` helper already renders a right-aligned,
  sortable relative-time column (used by **Modified**).
- Add a `rowCreated(row)` accessor (folder `createdAt` / document `createdAt`)
  mirroring `rowModified`, and register a second `dateColumn("createdAt",
  "Created", rowCreated)`.
- No backend/data-model change: `createdAt` already ships in the `Document`
  type and folder rows already carry `createdAt`.

## Steps

- [x] Add `rowCreated` accessor + `Created` column in `document-list.tsx`.
- [x] Add a `createdAt` accessor helper unit test if warranted.
- [x] Draft PR.

## Acceptance criteria

- The documents list shows a **Created** column with sort toggle (asc/desc),
  identical interaction to **Modified**.
- Folders stay pinned above documents regardless of which date column sorts.
- Default sort (most-recently-modified first) is unchanged.

## Non-goals

- Persisting the chosen sort across reloads.
- Any backend / API change.
