# Documents bulk multi-select move + drag-and-drop

Google-Drive-style multi-select on the workspace documents list, with two ways
to move a selection into a folder — an extended "Move to…" dialog and
drag-and-drop onto folder cards/breadcrumb — plus bulk delete.

Design: `docs/design/workspace-folders.md` → "Bulk multi-select move +
drag-and-drop" section.

## Decisions (from brainstorming)

- Move via **extended dialog + drag-and-drop** (both).
- Backend: **new bulk endpoints** (`PATCH documents/move`, `POST documents/delete`),
  single transaction for move, per-doc manager gate, **atomic reject** on any denial.
- Selection: **explicit checkboxes**; row click still opens the document.
- Bulk action bar: **Move to… · Delete · clear (+ count)**; Move/Delete enabled
  only when the whole selection is `canManage`.

## Backend

- [ ] `MoveDocumentsDto` (`{ ids: string[]; workspaceId?: string; folderId?: string | null }`)
      and `DeleteDocumentsDto` (`{ ids: string[] }`) in `document.dto.ts`.
- [ ] `PATCH documents/move` in `document.controller.ts` — one Prisma transaction;
      per-id `resolveDocManager` gate + `assertMember` (cross-ws) + `assertSameWorkspace`;
      reject `403` with offending ids if any fails; keep per-doc `updatedAt` bump.
- [ ] `POST documents/delete` — per-id manager gate then delete.
- [ ] Reject empty `ids`.
- [ ] Service unit tests: atomic reject on mixed selection; same-workspace folder
      validation; cross-workspace move drops folder; bulk delete gate; empty ids.

## Frontend — API + types

- [ ] `api/documents.ts`: `moveDocuments(ids, { workspaceId?, folderId? })` → `PATCH /documents/move`;
      `deleteDocuments(ids)` → `POST /documents/delete`.

## Frontend — selection

- [ ] Leading checkbox column in `document-list.tsx` (header select-all, per-row
      checkbox on hover/selected, shift-range via TanStack). Reuse existing
      `rowSelection` state; `getRowId` already = document id.
- [ ] Row click keeps opening the document (no behavior change).

## Frontend — bulk action bar

- [ ] Bar above table when `≥ 1` selected: "N selected", Move to…, Delete, clear (✕).
- [ ] Move/Delete disabled (with tooltip) unless every selected doc is `canManage`.

## Frontend — move dialog (generalize)

- [ ] Generalize `movingDoc` object → set of ids; title "Move N items" when `> 1`.
- [ ] Submit → `moveDocuments(ids, …)`. Route the per-row "Move" menu item through
      the same dialog with a single id (one code path).
- [ ] Bulk delete confirmation dialog → `deleteDocuments(ids)`.

## Frontend — drag-and-drop

- [ ] Rows `draggable` only when `canManage`; dragstart drags whole selection if
      the row is selected, else just that row; payload on `dataTransfer`
      (`application/x-wafflebase-docs` + ids).
- [ ] Folder cards + breadcrumb segments as drop targets; dragover highlight;
      drop → `moveDocuments(ids, { folderId })`.
- [ ] Verify no interference with `useWindowFileDrop` (custom MIME vs "Files").

## Frontend — tests

- [ ] select-all + shift-range; action bar enable/disable by whole-selection
      `canManage`; move dialog posts `{ ids, … }`; folder-card drop calls move.

## Verify

- [x] `pnpm verify:fast` green (frontend 857 / backend 1399 / sheets 2609 / … all pass, exit 0).
- [ ] Manual smoke in `pnpm dev`: multi-select, dialog move, DnD move, bulk delete,
      permission-gated disable. **Pending** — needs a running authenticated app
      (docker + OAuth); recommended before merge. Logic verified by unit tests +
      per-task reviews + a whole-branch opus review instead.

## Review

Executed via subagent-driven development: 8 tasks, one implementer + one task
reviewer each, then a whole-branch final review (opus).

**Commits** (`bb59cce1..dd9098bd`):
- `46abfcc4` bulk move endpoint (atomic, per-id gated)
- `abba1d88` bulk delete endpoint (per-id gated)
- `9212be67` frontend `moveDocuments`/`deleteDocuments` API
- `21051752` `document-bulk.ts` helpers (drag payload + `allManageable`)
- `6d0755ee` checkbox select column → `284873ac` fix shift-range double-toggle
- `119a999b` generalize move/delete dialogs to id-sets
- `7c2f84e3` bulk action bar
- `42e4b707` drag-and-drop onto folders + breadcrumb
- `dd9098bd` clear selection on folder/workspace change (final-review fix)

**Review outcomes:** every task passed spec + quality review. Two findings were
fixed mid-flight:
1. **Critical (task 5):** shift-range `onClick` + Radix `onCheckedChange` double-
   toggled the clicked row; fixed by `e.preventDefault()` in the shift branch to
   suppress Radix's internal toggle.
2. **Minor UX (final review):** stale `rowSelection` survived folder navigation,
   leaving the bulk bar showing disabled actions / rejecting valid DnD; fixed by
   resetting selection on `folderId`/`workspaceId` change.

**Final verdict:** Ready to merge — no blocking correctness/security issues.
Manager-gating holds per id on both bulk paths; move is atomic (one transaction,
validate-then-write); cross-workspace folder injection blocked via
`assertSameWorkspace`; internal row→folder DnD stays disjoint from the file-upload
drop by MIME type.

**Accepted non-blocking limitations:**
- Backend bulk loops use sequential per-id `await` (small N; correctness-neutral).
- `deleteDocuments` `{ deleted }` returns the requested ids, not `deleteMany`'s
  actual count (can cosmetically over-report on a concurrent delete; frontend
  ignores the payload).
- Minor test-coverage gaps: empty-ids delete case, non-string-array decode branch.
- `dragOverFolderId` type carries an unused `"root"` arm; breadcrumb `onDragOver`
  omits the `isDocDrag` gate (harmless — decode returns null for file payloads).
