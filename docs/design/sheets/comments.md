---
title: comments
target-version: 0.4.0
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# Sheet Cell Comments

## Summary

Add Google Sheets-style threaded comments anchored to spreadsheet cells. Phase B
(this document) covers single-cell threads with replies, resolve/reopen, and a
side panel for browsing all comments. Mentions, notifications, and broader
anchors (range, sheet, doc) are deferred to phase C.

The data model is designed *anchor-agnostic* from day one — a discriminated
`CommentAnchor` union allows future extraction into a shared
`@wafflebase/comments` package once Docs or Slides become a second consumer.
Until then, comment code lives inside `packages/sheets`.

## Goals / Non-Goals

### Goals

- Threaded comments anchored to a single cell. Multiple independent threads per
  cell are supported.
- Thread lifecycle: open → resolved → reopen, performed by any collaborator.
- Comment lifecycle: edit / delete by author only.
- Anchor stability: comments stay attached to the same logical cell across row
  or column inserts and deletes performed by other collaborators.
- Five UI surfaces: cell marker (canvas), cell-click popover, side panel
  ("Open" / "Resolved" tabs), composer entry points (right-click menu, toolbar,
  `Cmd/Ctrl+Alt+M`), and side-panel-to-cell navigation.
- Plain-text body with newlines.
- Real-time sync via the existing Yorkie pipeline.
- Read-only access for unauthenticated viewers.

### Non-Goals

- `@user` mentions and notifications (deferred to phase C).
- Range, full-row, full-column, sheet, or document-wide comments (phase C+).
- Rich-text body (bold, italics, links). Plain text + newlines only.
- Email / external notifications.
- Comment search across the workbook.
- Cross-package generalization at this stage. The shared
  `@wafflebase/comments` package is created when Docs adds comments.
- Per-user read/unread state.

## Proposal Details

### 1. Module Layout

```
packages/sheets/src/comment/
├── types.ts          # CommentAnchor, CommentAuthor, Comment, Thread
├── thread.ts         # pure helpers — create, validate, mutate threads
├── anchor.ts         # CellAnchor ↔ Sref helpers, anchor validation
└── index.ts          # public exports

packages/sheets/src/store/store.ts
└── Store interface gains six comment methods (§4)

packages/sheets/src/view/
└── render-comments.ts             # NEW — canvas marker rendering

packages/frontend/src/app/spreadsheet/
├── yorkie-store.ts                # Store impl gains comment methods
├── yorkie-worksheet-comments.ts   # NEW — Yorkie-local comment mutations
├── yorkie-worksheet-structure.ts  # MODIFY — orphan cleanup on row/col delete
└── components/comments/           # NEW — popover, side panel, composer
    ├── CommentPopover.tsx
    ├── CommentSidePanel.tsx
    └── CommentComposer.tsx
```

The shared `packages/sheets` package owns the data model, pure helpers, and the
Canvas grid renderer (which already lives at `packages/sheets/src/view/gridcanvas.ts`).
The frontend package owns the Yorkie boundary, the React UI (popover, side panel,
composer), and event wiring. Comment marker drawing extends the existing sheets
canvas pipeline. This mirrors the existing split for axis ID and structural
mutations described in [collaboration.md](./collaboration.md).

### 2. Data Model

```typescript
// packages/sheets/src/comment/types.ts

export type CommentAuthor = {
  userId: string;       // backend User.id
  username: string;
  photo?: string;
};

// Discriminated union — Docs / Slides extraction adds variants here.
export type CommentAnchor =
  | { kind: 'sheet-cell'; tabId: string; rowId: string; colId: string };
  // future: { kind: 'sheet-range'; tabId; startRowId; ...; endColId }
  // future: { kind: 'docs-range'; blockId; ... }
  // future: { kind: 'slide-element'; slideId; elementId }

export type Comment = {
  id: string;            // UUID v4
  author: CommentAuthor;
  body: string;          // plain text, '\n' allowed, non-empty after trim
  createdAt: number;     // Date.now()
  editedAt?: number;     // present iff body has been edited
};

export type Thread = {
  id: string;            // UUID v4
  anchor: CommentAnchor;
  comments: Comment[];   // [0] is root, rest are replies in author order
  resolved: boolean;
  resolvedAt?: number;
  resolvedBy?: CommentAuthor;
  createdAt: number;
};
```

#### Invariants

| Invariant                                                     | Where enforced               |
| ------------------------------------------------------------- | ---------------------------- |
| `comments.length >= 1` for any persisted thread               | `addThread`, `deleteComment` |
| Body is non-empty after trim                                  | `addThread`, `addReply`, `editComment` |
| `editedAt > createdAt` whenever set                           | `editComment`                |
| `resolved=true` ⇒ `resolvedAt` and `resolvedBy` are set       | `setThreadResolved`          |
| Deleting `comments[0]` deletes the whole thread               | `deleteComment`              |

### 3. Yorkie Schema

The canonical `Worksheet` shape lives in
[`collaboration.md`](collaboration.md#canonical-worksheet-shape).
This feature adds one optional field:

```typescript
// patch on Worksheet
+  comments?: { [threadId: string]: Thread };
```

Threads are keyed by their own `id`, **not** by `${rowId}|${colId}`, because
multiple threads can attach to the same cell. The anchor lives inside the
thread.

New worksheets seed `comments: {}` in `createWorksheet()` (alongside the
other map containers like `merges`, `charts`, `images`). This is required
for convergence: Yorkie resolves concurrent assignment of the same object
key by LWW, so if the container were created lazily on first comment
(`if (!ws.comments) ws.comments = {}`) two users adding the first comment
concurrently would each create a fresh map and one — with its thread —
would be discarded wholesale. A shared, bootstrap-seeded container means
concurrent inserts only set distinct keys, which merge.

The field stays optional so existing documents need no migration: the
lazy guard in `ensureComments()` remains as a fallback for legacy
worksheets created before the seeding. On those, two users adding the
*first-ever* comment concurrently can still race to create the container;
the window is one worksheet's first concurrent comment and self-heals
after one sync.

#### Cross-tab queries

`Thread.anchor.tabId` lets the side panel aggregate threads across all tabs
without a top-level index. The `SpreadsheetDocument` shape from
[collaboration.md](./collaboration.md) keeps tab metadata and worksheets in
parallel maps:

```typescript
const allThreads = Object.values(spreadsheetDoc.sheets).flatMap(
  (worksheet) => Object.values(worksheet.comments ?? {}),
);
```

#### Concurrency semantics

| Scenario                                                | Yorkie behavior                       | Outcome |
| ------------------------------------------------------- | ------------------------------------- | ------- |
| Two users add a thread to the same cell concurrently    | Different `threadId` keys on the shared, bootstrap-seeded `comments` container | Both preserved (see container-seeding note above) |
| Two users add a reply to the same thread concurrently   | `Thread.comments[]` array CRDT push   | Both preserved, deterministic order |
| One user edits, another deletes the same comment        | Delete wins (parent removal)          | Comment lost (Google Sheets parity) |
| Two users resolve the same thread concurrently          | LWW on `resolved`                     | Final state consistent |
| One user deletes a row, another edits a comment in it   | Row delete wins; thread auto-deleted  | See §5 |

`Thread.comments: Comment[]` is a Yorkie array CRDT (same kind as
`rangeStyles[]` and `hiddenRows[]` in the existing schema), so concurrent
replies are preserved by Yorkie array merge.

### 4. Store Interface

Six methods are added to `Store`. All async to honor the Yorkie transaction
boundary.

```typescript
// packages/sheets/src/store/store.ts
export interface Store {
  // ... existing methods ...

  /** Create a new thread with a root comment at the anchor. */
  addThread(
    anchor: CommentAnchor,
    body: string,
    author: CommentAuthor,
  ): Promise<Thread>;

  /** Append a reply to an existing thread. */
  addReply(
    threadId: string,
    body: string,
    author: CommentAuthor,
  ): Promise<Comment>;

  /** Edit a comment body. Caller is responsible for author check. */
  editComment(threadId: string, commentId: string, body: string): Promise<void>;

  /** Delete a comment. Deleting comments[0] deletes the whole thread. */
  deleteComment(threadId: string, commentId: string): Promise<void>;

  /** Resolve or reopen a thread. */
  setThreadResolved(
    threadId: string,
    resolved: boolean,
    by: CommentAuthor,
  ): Promise<void>;

  /** Read threads filtered by tab, anchor, or resolved state. */
  listThreads(opts?: {
    tabId?: string;
    cellAnchor?: { rowId: string; colId: string };
    resolved?: boolean;
  }): Promise<Thread[]>;
}
```

`MemStore` (test fixture) and `ReadonlyStore` get no-op or in-memory
implementations as appropriate.

#### Subscription

No new subscription API. UI components subscribe to `worksheet.comments` via
the existing Yorkie change pipeline used for cells, charts, and presence — see
[collaboration.md §Structural Edit Flow](./collaboration.md).

### 5. Anchor Stability and Orphan Cleanup

Because `CommentAnchor.sheet-cell` carries `rowId` / `colId` (not `Sref`),
inserts and moves require zero work — the visual position is recomputed from
the current `rowOrder` / `colOrder`, exactly like
[axis-id-selection](./axis-id-selection.md) does for selection.

Row and column **deletion** is the only structural edit that needs explicit
handling. When a row or column is removed, threads anchored to it become
orphans pointing to a non-existent axis. Three options were considered:

| Option         | Pros                                  | Cons                                                                 |
| -------------- | ------------------------------------- | -------------------------------------------------------------------- |
| Auto-delete    | Matches Google Sheets; clean state    | Data loss on accidental row delete (mitigated by undo)               |
| Auto-resolve   | Preserves data                        | "Resolved" panel fills with broken anchors; no recovery on re-insert |
| Keep as orphan | No data loss                          | UI complexity; broken-anchor state to design                         |

**Decision: auto-delete in the same transaction as the row/column shift.**

Because the deletion happens inside the same `doc.update()` block that removes
the row, Yorkie history packages both changes together — undo of the row
delete restores the thread.

```typescript
// packages/frontend/src/app/spreadsheet/yorkie-worksheet-structure.ts
export function deleteThreadsForAxis(
  worksheet: yorkie.JsonObject,
  axis: 'row' | 'col',
  deletedAxisIds: Set<string>,
): void {
  const comments = worksheet.comments;
  if (!comments) return;
  for (const [threadId, thread] of Object.entries(comments)) {
    if (thread.anchor.kind !== 'sheet-cell') continue;
    const id = axis === 'row' ? thread.anchor.rowId : thread.anchor.colId;
    if (deletedAxisIds.has(id)) delete comments[threadId];
  }
}
```

This is invoked from `shiftCells` (delete path) and `moveCells` immediately
after the cell map is rewritten.

### 6. UI

#### 6.1 Component tree

```
SpreadsheetPage
├── GridCanvas
│   └── (canvas) CommentMarkerLayer            — yellow triangle in cell corner
├── CommentPopover                              — absolutely positioned, on cell click
└── CommentSidePanel                            — right side, "Open" / "Resolved" tabs
    └── CommentComposer                         — also embedded in popover for replies
```

`CommentMarkerLayer` is **not** a separate DOM layer — markers are drawn
directly on the existing grid canvas during the per-cell render pass, like
conditional-format indicators. Filter: `tabId === currentTab && !resolved`.

#### 6.2 Entry points

| Action                   | Trigger                                                  | Result                                                |
| ------------------------ | -------------------------------------------------------- | ----------------------------------------------------- |
| New comment              | Right-click → "Insert comment" / `Cmd+Alt+M` / toolbar   | Empty composer at active cell anchor                  |
| View thread              | Click cell with marker                                   | Popover with all open threads on that cell            |
| Reply                    | "Reply" button inside popover                            | Inline composer                                       |
| Resolve                  | ✓ button on a thread                                     | Optimistic UI, then `setThreadResolved(true)`         |
| Reopen                   | "Reopen" button on a resolved thread                     | `setThreadResolved(false)`                            |
| Side panel toggle        | Toolbar comment icon / `Cmd+Alt+Shift+M`                 | Toggle right-side panel                               |
| View resolved            | "Resolved" tab in side panel                             | List of `resolved=true` threads                       |
| Jump to cell             | Click a thread row in side panel                         | Switch to anchor tab, scroll to and highlight cell    |

#### 6.3 Marker style

| Property        | Value                                          |
| --------------- | ---------------------------------------------- |
| Shape           | 7 × 7 px right triangle (top-right of cell)    |
| Color           | `#fbbc04` (Google Sheets parity)               |
| Resolved hidden | Yes — only `resolved=false` shows a marker     |

#### 6.4 Read-only / unauthenticated users

- Markers and popover render normally.
- Composer is disabled. Click → toast "Sign in to leave a comment."
- Resolve / reopen / edit / delete buttons are hidden.

#### 6.5 Popover placement

The popover is 320 px wide and a variable height (grows with thread count
and composer state). Placement preserves two invariants:

1. **The popover stays fully inside the grid panel** — never clipped by the
   right or bottom edge of the spreadsheet container.
2. **The active cell stays visible** — the popover never sits on top of
   the cell it anchors to.

Placement order:

| Order | Placement              | Accepted when                                                         |
| ----- | ---------------------- | --------------------------------------------------------------------- |
| 1     | Right of cell, top-aligned    | `cellRight + GAP + popoverW ≤ parentW − PAD`                   |
| 2     | Left of cell, top-aligned     | `cellLeft − GAP − popoverW ≥ PAD`                              |
| 3     | Below cell, horizontally clamped | Neither side fits (cell wider than half the panel); flip above if no room below |

Within order 1 / 2 (the **side** modes), the popover is top-aligned with
the cell row; if the popover height overflows the bottom edge, it flips
to `cellBottom − popoverH` (Google Sheets parity).

Constants: `GAP = 4 px` between cell and popover, `PAD = 8 px` viewport
inset. Placement is computed in a `useLayoutEffect` that measures the
rendered popover height; until measured, the wrapper renders with
`visibility: hidden` to avoid a first-paint flash. The same pattern is
used in `DocsCommentPopover.tsx`, but with a simpler clamp — docs has no
"avoid the cell" constraint because the marker is much smaller than the
popover.

### 7. Testing Strategy

#### 7.1 Unit (sheets package, Vitest)

`packages/sheets/src/comment/__tests__/`:

- `thread.test.ts` — thread/comment creation, body validation (empty rejection,
  newline allowed), root deletion cascades, edit timestamps, resolve transitions.
- `anchor.test.ts` — `CellAnchor` ↔ `Sref` conversion against an axis order.

#### 7.2 Yorkie integration (frontend, e2e)

`packages/frontend/src/app/spreadsheet/__tests__/comments.test.ts`:

- Concurrent thread creation on the same cell — both preserved.
- Concurrent replies on the same thread — both preserved.
- Row delete vs comment edit — delete wins, thread auto-deletes, undo restores.
- Concurrent resolve — final state consistent.

#### 7.3 Visual / interaction (browser harness)

`packages/frontend/visual/comments.spec.ts`:

- Marker render position and color.
- Cell click → popover anchored correctly.
- `Cmd+Alt+M` opens composer focused on the input.
- Side panel tab counts update on resolve / reopen.
- Side panel click scrolls to and highlights the anchor cell.

#### 7.4 Verify lanes

- `pnpm verify:fast` — unit tests.
- `pnpm verify:full` — Yorkie integration.
- `pnpm verify:browser:docker` — visual.

### 8. Phase Plan

| Phase  | Scope                                                                |
| ------ | -------------------------------------------------------------------- |
| **B**  | Everything in this document.                                         |
| C      | `@user` mentions, notifications (in-app + email), per-user unread.   |
| C+     | Range / row / column / sheet anchors, cross-package extraction to `@wafflebase/comments`. |

## Risks and Mitigation

| Risk                                                                                   | Mitigation                                                                                                                  |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Auto-delete on row / column removal is destructive                                     | Same-transaction delete means undo restores. Explicit confirmation is **not** added — Google Sheets parity, low surprise.   |
| `Thread.comments[]` array CRDT semantics differ from per-key map under heavy contention | Replies are append-only; CRDT array merge handles append concurrency correctly. Edit/delete races covered in §3.            |
| Marker rendering cost on large grids                                                   | Marker draw is O(visible cells with a comment), not O(all comments). Same iteration as conditional-format markers.          |
| Future generalization to Docs / Slides drifts the schema                               | Anchor is already a discriminated union; keeping `anchor.kind` opaque inside thread logic from day one prevents lock-in.    |
| Backend authorization for unauthenticated viewers                                       | The Yorkie backend already enforces read-only for anonymous; this design adds no new permission surface beyond Store calls. |
