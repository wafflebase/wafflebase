---
title: workspace-folders
target-version: 0.7.0
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# Workspace Folders

## Summary

Documents today belong directly to a `Workspace` via a single `workspaceId`
foreign key; there is no way to group them. As a workspace accumulates
documents, the flat, modified-date-sorted list in
`packages/frontend/src/app/documents/document-list.tsx` becomes
the only organizing surface, and the sole "move" primitive is relocating a
document to a *different workspace*. This proposal adds a **Folder** concept
*inside* a workspace: an arbitrary-depth tree of folders that documents can be
filed into, navigated by in-list drill-in and a breadcrumb.

The model mirrors Google Drive's **Shared Drive** folder tree — which is the
right analog, since a Wafflebase `Workspace` is already an org-owned,
membership-scoped container just like a Shared Drive. Two deliberate
simplifications keep the first release tight: folders are a **single-parent
tree** (Drive dropped multi-parent files in 2020 in favor of shortcuts, so a
tree is the modern model), and folders are **purely organizational** — they
never change who can access a document. Access continues to be governed
entirely by workspace membership and per-document share links.

### Goals

- A `Folder` model scoped to a workspace, nesting to arbitrary depth.
- File a document into a folder (nullable `folderId`, `null` = workspace root).
- Navigate folders in the workspace document list via drill-in + breadcrumb.
- Reuse the existing manager-gating (`isDocumentManager`) for folder
  create/rename/move/delete — no new permission surface.
- Non-destructive deletes: removing a folder never deletes a document.

### Non-Goals

- **Permission inheritance** — folders do not carry sharing; a folder never
  grants or revokes access to the documents inside it.
- **Sidebar folder tree** — navigation is in-list drill-in only; the sidebar
  keeps its current workspace switcher.
- **REST API v1 folder support** — v1 cannot even move a document between
  workspaces today; folder support there is a follow-up.
- **Multi-parent folders / shortcuts, trash, folder color/star** — all deferred.

> **Delivered in a follow-up:** the v1 doc deferred *bulk multi-select move*
> and *drag-and-drop*. Both are now specified in
> [Bulk multi-select move + drag-and-drop](#bulk-multi-select-move--drag-and-drop)
> below.

## Proposal Details

### Data model (`packages/backend/prisma/schema.prisma`)

A new `Folder` model plus a nullable `folderId` on `Document`. `Folder`
self-references via `parentId` for the tree, and carries `authorID` so the
existing `isDocumentManager(role, authorID, userId)` predicate can gate folder
mutations without a new predicate.

```prisma
model Folder {
  id          String     @id @default(uuid())
  name        String
  workspaceId String
  workspace   Workspace  @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  parentId    String?
  parent      Folder?    @relation("FolderTree", fields: [parentId], references: [id], onDelete: Cascade)
  children    Folder[]   @relation("FolderTree")
  documents   Document[]
  authorID    Int?
  author      User?      @relation(fields: [authorID], references: [id])
  createdAt   DateTime   @default(now())

  @@index([workspaceId, parentId])
}
```

On `Document`, add:

```prisma
  folderId String?
  folder   Folder? @relation(fields: [folderId], references: [id], onDelete: SetNull)

  @@index([workspaceId, folderId])
```

`Workspace` gains a `folders Folder[]` back-relation; `User` gains a
`folders Folder[]` back-relation. These are the schema's first `@@index`
declarations — a `folderId` filter on the documents list wants the index.

**The delete rule is enforced by the database, not by service code:**

| Relation | `onDelete` | Effect when a folder is deleted |
| -------- | ---------- | ------------------------------- |
| `Folder.parent` (self) | `Cascade` | All descendant folders are removed. |
| `Document.folder` | `SetNull` | Every document in the subtree returns to workspace root (`folderId = null`). |

Net effect: **a folder delete never deletes a document.** The subtree of
folders collapses; the documents it contained reappear at the workspace root.
This matches the "organizational only" contract — folders are a view over
documents, never their owner.

### Backend — Folder controller (`packages/backend/src/folder/`)

A new module mirroring `document/`, all routes under `JwtAuthGuard`, gating via
`assertMember` / `isDocumentManager`.

| Method | Route | Auth | Body / Query | Notes |
| ------ | ----- | ---- | ------------ | ----- |
| `POST` | `workspaces/:wid/folders` | member | `{ name, parentId? }` | Any member, like creating a document. `parentId` validated to belong to the same workspace. |
| `GET` | `workspaces/:wid/folders` | member | — | Flat list `{ id, name, parentId, authorID, createdAt }`; client builds the tree/breadcrumb. |
| `PATCH` | `folders/:id` | see notes | `{ name?, parentId? }` | `name` (rename): any member. `parentId` (move): manager-gated + cycle check. |
| `DELETE` | `folders/:id` | manager | — | DB cascade/SetNull handles descendants and documents. |

**Cycle prevention on move.** Setting `parentId` must not make a folder its own
ancestor. The service walks from the target parent up to the root; if the
folder being moved appears in that chain (or equals the target), it rejects
with `400`. Moving to `parentId: null` (workspace root) is always allowed.

**Folder-manager gate.** `authorID` on `Folder` lets folder move/delete reuse
`isDocumentManager(memberRole, folder.authorID, userId)` verbatim — the same
owner-or-author rule documents already use. No `isFolderManager` needed.

### Backend — Document changes (`packages/backend/src/document/`)

Three small touch-ups, no new endpoints:

- **`packages/backend/src/document/document.dto.ts`** — `UpdateDocumentDto`
  gains optional nullable `folderId`; `CreateDocumentInWorkspaceDto` gains
  optional `folderId` so a document can be created straight into a folder.
- **`packages/backend/src/document/document.controller.ts`** — the existing
  manager-gated move branch in
  `PATCH documents/:id` (which today handles `workspaceId`) also handles
  `folderId`, validating `folder.workspaceId === document.workspaceId` (against
  the *target* workspace when a workspace + folder move happen together). The
  `DocumentListItem` type returns `folderId`.
- **`GET workspaces/:wid/documents`** — gains an optional `?folderId=` query
  param. Omitted means the workspace root (`folderId IS NULL`); a value filters
  to that folder. `orderBy` is unchanged.

The global `GET /documents` (all workspaces) stays flat and folder-agnostic —
folder navigation is a per-workspace surface.

### Data flow — entering a folder

```text
/w/:wid                        /w/:wid?folder=<fid>
  │                              │
  ├─ GET .../folders  ──────────►├─ GET .../folders            (all folders, cached)
  │    (build breadcrumb + rows) │    (breadcrumb = walk fid→root)
  │                              │
  └─ GET .../documents           └─ GET .../documents?folderId=<fid>
       (root docs)                    (docs in this folder)
```

### Frontend

Folder navigation lives only in the workspace route `/w/:workspaceId`, tracked
by a `?folder=<id>` query param so browser back and the breadcrumb work with
history. The sidebar is unchanged.

- **`packages/frontend/src/api/folders.ts`** (new) —
  `fetchFolders(workspaceId)`, `createFolder`, `renameFolder`, `moveFolder`,
  `deleteFolder`. In `packages/frontend/src/api/documents.ts`, extend
  `moveDocument(id, { workspaceId?, folderId? })`
  and `fetchWorkspaceDocuments(workspaceId, folderId?)`.
- **`packages/frontend/src/types/documents.ts`** — add a `Folder` type; add
  `folderId` to `Document`.
- **`packages/frontend/src/app/workspaces/workspace-documents.tsx`** — read the
  `folder` query param; fetch folders (whole workspace) and documents for the
  current folder; pass both plus the current `folderId` into `DocumentList`.
- **`packages/frontend/src/app/documents/document-list.tsx`** —
  - **Folders render as rows** (folder icon) above documents in the same
    TanStack table; clicking a folder row drills in by updating `?folder=`.
  - A **breadcrumb** above the table (`Workspace / A / B`), each segment a
    link, computed by walking `folderId → root` over the folder list.
  - "New folder" joins the existing New menu; folder rows get Rename / Move /
    Delete actions gated on `canManage`, mirroring document rows.
- **Move dialog (extended, not replaced)** — after the workspace `<Select>`
  (default: current), add a folder picker for the chosen workspace (folders
  fetched for that workspace, default root). One dialog now serves both
  move-to-workspace and move-into-folder. Changing the workspace resets the
  folder selection to root.

### Testing

- **Service (unit):** folder create/rename/move/delete; **cycle rejection** on
  move (folder into its own descendant → 400); same-workspace validation on
  `parentId` and on document `folderId`.
- **DB integration:** deleting a folder cascades descendant folders and
  `SetNull`s documents to root (no document is deleted); `?folderId` filtering
  returns the correct set.
- **Frontend:** breadcrumb derivation from the flat folder list; drill-in
  updates the query param and refetches; the extended move dialog posts
  `{ workspaceId, folderId }`.

## Bulk multi-select move + drag-and-drop

The v1 move primitive is single-document only, both frontend and backend
(`document.controller.ts` `PATCH documents/:id`, and the single-`movingDoc`
dialog in `document-list.tsx`). This follow-up adds Google-Drive-style
**multi-select** with two ways to move a selection into a folder: an extended
**"Move to…" dialog** and **drag-and-drop** onto folder rows/cards. Selection
is explicit (checkboxes) so the current row-click-to-open behavior is preserved.

### Backend — two bulk endpoints

Both mirror the existing single-document validation per id; both are
manager-gated per document via the same `resolveDocManager` predicate.

| Method | Route | Body | Notes |
| ------ | ----- | ---- | ----- |
| `PATCH` | `documents/move` | `{ ids: string[], workspaceId?, folderId? }` | Move N documents. Single Prisma transaction. **Atomic**: if any id fails the manager gate or same-workspace validation, reject `403` with the offending ids and move nothing. `workspaceId`+`folderId` together behave like the single path (crossing workspace drops the folder unless `folderId` is given). Per-doc `updatedAt` bump kept, matching the single move. |
| `POST` | `documents/delete` | `{ ids: string[] }` | Delete N documents (manager-gated per id). Symmetric with the bulk move; avoids N fan-out `DELETE` calls. |

New DTOs `MoveDocumentsDto` / `DeleteDocumentsDto` in `document.dto.ts`. The
existing single-document `PATCH documents/:id` and `DELETE documents/:id` stay
for the per-row menu (or are re-expressed as `ids: [id]` — see frontend).

Validation reuses the single-path helpers verbatim per id: `assertMember`
(cross-workspace), `assertSameWorkspace(folderId, targetWorkspaceId)`, and the
`resolveDocManager` owner-or-author gate. The transaction means a mixed
selection (some manageable, some not) is rejected as a unit rather than
half-applied.

### Frontend — selection state

Selection is **view-local**, so it stays in the already-wired but currently
inert TanStack `rowSelection` state in `document-list.tsx` (no module-singleton
store needed — unlike the upload queue, selection doesn't outlive the list).
`getRowId` already keys rows by document id.

- A leading **checkbox column**: header select-all, per-row checkbox (shown on
  hover / when selected), shift-click range select (TanStack built-in).
- **Row click still opens the document** (unchanged). Only the checkbox mutates
  selection. This is the Gmail/Drive-list model and keeps the existing behavior
  intact.

### Frontend — bulk action bar

When `≥ 1` row is selected, the **existing always-present toolbar row** (search
+ type filters + New) swaps its contents **in place** for the selection controls:
**"N selected" · Move to… · Delete · ✕ (clear)**. Reusing the same row (rather
than inserting a new bar above the table) keeps the row height constant, so
selecting/deselecting never shifts the list up or down — the Google-Drive
selection-toolbar pattern.

- Move / Delete are enabled **only when every selected document is manageable**
  by the user (`canManage`); otherwise disabled with a tooltip. Selection
  itself is unrestricted (you can select any row to see the count), but the
  destructive/relocating actions require full permission over the set — which
  matches the atomic backend contract.

### Frontend — move dialog (generalized)

The existing dialog is reused: the single `movingDoc` object generalizes to a
**set of ids** (title becomes "Move N items" when `> 1`). Workspace + folder
pickers are unchanged. Submit calls a new `moveDocuments(ids, { workspaceId,
folderId })`. The **per-row "Move" menu item routes through the same dialog with
a single id**, collapsing to one code path.

Bulk delete reuses a confirmation dialog ("Delete N documents?") → `deleteDocuments(ids)`.

### Frontend — drag-and-drop

- Rows are **`draggable` only when `canManage`**. On `dragstart`, if the dragged
  row is part of the current selection the whole selection is dragged; otherwise
  just that row. The payload rides on `dataTransfer` under a custom type
  `application/x-wafflebase-docs` carrying the ids.
- **Drop targets**: folder cards (the existing grid) and breadcrumb segments
  (drop onto an ancestor / root). `dragover` highlights the target; `drop`
  calls `moveDocuments(ids, { folderId })`.
- **Coexistence with `useWindowFileDrop`** (upload DnD) is safe: that listener
  only reacts to `dataTransfer.types.includes("Files")`, and the internal drag
  carries a custom MIME type, not OS files — so the two DnD systems don't
  interfere.

### API layer

`api/documents.ts` gains `moveDocuments(ids, { workspaceId?, folderId? })` →
`PATCH /documents/move` and `deleteDocuments(ids)` → `POST /documents/delete`.

### Testing (this follow-up)

- **Backend:** bulk move rejects atomically (`403`) when one id isn't
  manageable; same-workspace folder validation; cross-workspace move drops the
  folder; bulk delete gate; empty `ids` rejected.
- **Frontend:** select-all + shift-range selection; action bar enable/disable by
  whole-selection `canManage`; move dialog posts `{ ids, workspaceId, folderId }`;
  a folder-card drop calls `moveDocuments` with the selection ids.

## Risks and Mitigation

- **Move cycles** → a folder made its own ancestor would corrupt the tree.
  Mitigated by a service-side walk-up guard that rejects with `400` before the
  write; `parentId: null` is always safe. The guard also carries a `visited`-set
  break so a pre-existing corrupt cycle can't spin the walk forever.
- **Concurrent folder moves (TOCTOU)** → two managers reparenting folders in the
  same subtree at once could each pass `assertNoCycle` before either commits,
  producing a cycle the guard would otherwise reject. Not mitigated in v1: a
  correct fix needs an interactive transaction with pessimistic row locking
  (`SELECT … FOR UPDATE` over the ancestor chain), which is disproportionate
  given folder trees are small, moves are manager-only and infrequent, and the
  blast radius is a rare, recoverable cycle rather than data loss. Tracked as a
  follow-up.
- **Cross-workspace folder assignment** → filing a document into a folder from
  another workspace would orphan it. Mitigated by validating
  `folder.workspaceId === document.workspaceId` (target workspace) on every
  document `folderId` write and on folder `parentId` writes.
- **`updatedAt` bump on move** → moving a document currently advances its
  hand-managed `updatedAt`, reshuffling the modified-date sort. This proposal
  keeps that behavior for consistency with the existing move-to-workspace path,
  but Google Drive does *not* touch modified-time on move; special-casing pure
  folder moves to skip the bump is a cheap follow-up if the reshuffle is
  surprising.
- **Concurrent delete/move** → deleting a folder while a document is being
  filed into it is safe: `SetNull` leaves the document at root rather than
  orphaned, and the folder-tree `Cascade` cannot strand a child folder.
- **Deep nesting / large folder counts** → `GET .../folders` returns every
  folder in the workspace. This is a small payload at expected scale, and the
  `@@index([workspaceId, parentId])` keeps it cheap; if a workspace ever grows
  to thousands of folders, a lazy per-level fetch is a later optimization.
- **Global vs workspace list divergence** → the `/documents` all-workspaces
  list ignores folders and stays flat. This is intentional (folders are a
  per-workspace organizing surface), but documented so the two lists reading
  differently is not mistaken for a bug.
- **Atomic bulk move rejects a partially-manageable selection** → moving a
  mixed set (some manageable, some not) fails entirely rather than moving what
  it can, unlike Google Drive's best-effort move. Mitigated by gating the bulk
  Move/Delete buttons on *whole-selection* `canManage` in the frontend, so the
  user cannot trigger a doomed request; the atomic `403` is a defense-in-depth
  backstop, not the primary UX. Best-effort partial move is a later option if
  the all-or-nothing rule proves surprising.
- **Two DnD systems on one page** → internal row→folder drag coexists with the
  window-level file-upload drop (`useWindowFileDrop`). Kept disjoint by MIME
  type: uploads key on `dataTransfer.types.includes("Files")`, the internal drag
  uses `application/x-wafflebase-docs`. Neither handler fires for the other's
  payload.
- **Bulk delete atomicity** → unlike bulk move, `POST documents/delete` is not
  wrapped in a single fail-if-any-denied transaction contract in v1; it is
  manager-gated per id and the frontend already restricts the action to a
  fully-manageable selection, so a partial delete is not reachable through the
  UI. If direct API callers need strict atomicity it can adopt the same
  all-or-nothing validation pass as move.
