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

- [ ] `pnpm verify:fast` green.
- [ ] Manual smoke in `pnpm dev`: multi-select, dialog move, DnD move, bulk delete,
      permission-gated disable.

## Review

_(fill in after implementation)_
