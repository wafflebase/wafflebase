# Lessons — Documents bulk multi-select move + drag-and-drop

_(Capture patterns and corrections as they come up during implementation.)_

## Context notes from exploration

- TanStack `rowSelection` was already wired in `document-list.tsx` (state,
  `onRowSelectionChange`, `data-state` on the row) but **inert** — no checkbox
  column, no bulk bar. The feature is mostly UI on top of existing plumbing.
- Folders render as a **card grid above the table**, not as table rows (the v1
  design doc's "folders as rows" plan wasn't followed) — they are the natural
  DnD drop targets.
- `useWindowFileDrop` reacts only to `dataTransfer.types.includes("Files")`, so
  an internal row→folder drag with a custom MIME type won't collide with the
  upload-drop overlay.
- Move/delete were single-id only, frontend and backend; no bulk endpoint existed.

## Lessons from implementation

- **Radix `Checkbox` + a manual `onClick` double-fire.** A custom `onClick` that
  writes selection state does NOT replace Radix's own toggle: Radix wraps
  consumer handlers with `composeEventHandlers`, which still runs its internal
  toggle (firing `onCheckedChange`) unless the consumer calls
  `e.preventDefault()`. `stopPropagation()` is not enough. For a shift-range
  handler that owns the write, call `preventDefault()` on that branch so the
  clicked row isn't toggled a second time. (Caught in review, not by unit tests —
  a component test with a Radix checkbox would have surfaced it.)
- **Reset view-local selection on navigation.** `rowSelection` keyed by document
  id survives a folder/workspace change, and because permission checks resolve
  the stale ids against the *new* list they read as unmanageable — disabling the
  bulk bar and rejecting valid drags. Reset with
  `useEffect(() => setRowSelection({}), [folderId, workspaceId])`.
- **NestJS static-vs-param route ordering.** `@Patch('documents/move')` must be
  declared before `@Patch('documents/:id')` or `move` is captured as an `:id`.
- **Atomic bulk mutation shape.** Validate every id (existence + per-id manager
  gate + `assertSameWorkspace`) up front, collect denials, throw once, then do
  all writes in a single `prisma.$transaction`. Keeps a mixed selection
  all-or-nothing instead of half-applied.
- **The plan's example code is a starting point, not proven-correct.** The
  shift-range double-toggle shipped verbatim from the plan and still had a
  Critical bug — the per-task review is what caught it. Don't treat
  plan-provided snippets as pre-reviewed.
