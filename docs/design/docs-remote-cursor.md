---
title: docs-remote-cursor
target-version: 0.3.1
---

# Docs Remote Cursor

## Summary

Display remote peer cursors with name labels in the collaborative docs editor.
Each peer's cursor appears as a colored caret line with a username tag, letting
users see where collaborators are editing in real time. Labels appear
temporarily when a peer moves and on mouse hover, keeping the canvas
uncluttered.

## Goals / Non-Goals

### Goals

- Display a colored caret at each peer's cursor position in the document.
- Show the peer's username as a label above the caret.
- Auto-show the label for ~4 seconds when a peer moves, then hide.
- Show the label while the local user hovers near a peer's caret.
- Work correctly with pagination (only render cursors on visible pages).
- Reuse Sheets' color palette and label rendering patterns.

### Non-Goals

- Remote selection highlight (Phase 2 — planned but not in this scope).
- Avatar or profile picture in the label.
- Animated fade-in / fade-out transitions.
- Off-screen peer indicators (e.g., "User X is on page 3").
- Showing a label for the local user's own cursor.

## Proposal Details

### 1. Presence Type Separation

Sheets and docs use separate Yorkie documents (`sheet-{id}` / `doc-{id}`),
so their presence types should be separate rather than a shared union.

```ts
// Shared base — reference existing User type in packages/frontend/src/types/users.ts
// (id, authProvider, username, email, photo)

// Sheets presence (existing, in packages/frontend/src/types/users.ts)
type SheetPresence = {
  activeCell?: Sref;
  activeTabId?: string;
} & User;

// Docs presence (new, in packages/frontend/src/types/users.ts)
type DocsPresence = {
  activeCursorPos?: {
    blockId: string;
    offset: number;
  };
} & User;
```

No `activeDocId` filtering field is needed since each Yorkie document is
already scoped to a single document.

### 2. Presence Stays in the Frontend Layer

The `DocStore` interface in `packages/docs/src/store/store.ts` remains
**free of presence concerns**. Presence is a collaboration feature that
belongs in the frontend integration layer, not the document model.

Instead of adding `getPresences()` / `updateCursorPos()` to `DocStore`:

- **`YorkieDocStore`** exposes presence methods directly (not through the
  `DocStore` interface), since it is already a frontend-layer class.
- **`MemDocStore`** is unaffected — no presence code needed.
- Peer cursor data is passed into the editor's render method as a parameter,
  keeping the `@wafflebase/docs` package decoupled from user identity.

```ts
// packages/frontend/src/app/docs/yorkie-doc-store.ts
class YorkieDocStore implements DocStore {
  // DocStore methods (unchanged) ...

  // Presence methods (frontend-layer only, not part of DocStore interface)
  updateCursorPos(pos: DocPosition | null): void {
    this.doc.update((_, p) => p.set({ activeCursorPos: pos ?? undefined }));
  }

  getPresences(): Array<{
    clientID: string;
    presence: DocsPresence;
  }> {
    return this.doc.getOthersPresences();
  }
}
```

### 3. Peer Cursor Data Flow

Peer cursor data flows from Yorkie presence to the Canvas renderer through
the frontend integration layer:

```
Yorkie others-changed event
  → DocsView subscribes directly to the Yorkie document
  → Updates label visibility state (timers, hover)
  → Passes PeerCursor[] to editor.render()
  → DocCanvas renders carets + labels
```

**PeerCursor type** (defined in the docs package for rendering):

```ts
// packages/docs/src/view/types.ts (or doc-canvas.ts)
type PeerCursor = {
  position: DocPosition;
  color: string;
  username: string;
  labelVisible: boolean;   // controlled by DocsView visibility state
};
```

The docs package receives pre-processed rendering data and has no knowledge
of Yorkie, presence, or user identity systems.

### 4. Peer Cursor Rendering (doc-canvas.ts)

`DocCanvas.render()` receives an optional `peerCursors: PeerCursor[]`
parameter. After drawing the local cursor, it iterates over peer cursors.

**Coordinate calculation:**

Extract a shared utility from the existing `Cursor.getPixelPosition()` logic
to convert any `DocPosition { blockId, offset }` into pixel coordinates
using `layout` + `paginatedLayout`.

- Look up the block in the layout by `blockId`.
- Find the line containing `offset` and measure text width up to that offset.
- Apply pagination offset for the correct page.
- Skip rendering if the resulting position is outside the current viewport.

For remote cursors, `lineAffinity` is not included in the presence data.
Default to `'backward'` affinity, which places the cursor at the end of the
previous visual line at wrap boundaries. This is a minor visual inaccuracy
that is acceptable for peer cursor display.

**Caret rendering:**

| Property   | Value                               |
| ---------- | ----------------------------------- |
| Width      | 2 px                                |
| Height     | Same as line height at that position |
| Color      | Peer's assigned color               |

**Color assignment:**

Use the same color palette as Sheets, indexing by `clientID` hash for
consistent assignment. Color assignment happens in `DocsView` (frontend
layer) before passing data to the renderer.

### 5. Peer Label Rendering

Draw a name tag above the peer caret, following the Sheets `drawPeerLabel()`
pattern. Only rendered when `peerCursor.labelVisible` is `true`.

| Property      | Value                                          |
| ------------- | ---------------------------------------------- |
| Position      | Top of caret, offset upward                    |
| Background    | Peer cursor color (opaque)                     |
| Text color    | White (`#FFFFFF`) — consistent with Sheets     |
| Font          | 11 px sans-serif                               |
| Padding       | 4 px horizontal, 2 px vertical                 |
| Content       | `username`, truncated with ellipsis at 120 px  |
| Max width     | 120 px                                         |

**Edge cases:**

- **Top boundary:** If caret is near the top of a page, flip the label below
  the caret.
- **Right boundary:** Clamp label x so it doesn't overflow the canvas width.
- **Multiple peers at same position:** Stack labels vertically, sorted by
  `clientID` for stable ordering.

### 6. Label Visibility State

Managed in `DocsView` (frontend layer), following the Sheets `Worksheet`
pattern. This state is used to compute `labelVisible` for each `PeerCursor`
before passing to the renderer.

```ts
peerLabelTimers: Map<string, number>           // clientID → setTimeout id
prevPeerCursorPos: Map<string, DocPosition>    // previous position
hoveredPeerClientID: string | null
visiblePeerLabels: Set<string>                 // clientID set (username looked up from presence at render time)
```

**Trigger: peer cursor moves**

On each presence update, compare current `activeCursorPos` with
`prevPeerCursorPos`. If different:

1. Clear any existing timer for that peer.
2. Add to `visiblePeerLabels`.
3. Start ~4-second timer; on expiry remove from `visiblePeerLabels` and
   re-render.
4. Update `prevPeerCursorPos`.

**Trigger: local mouse hover**

In the mousemove handler, compute pixel distance from mouse to each peer's
caret position. If within a 10 px radius of the caret, set
`hoveredPeerClientID` and show the label. Clear when the mouse moves away.

**Label visible when:** peer is in `visiblePeerLabels` (active timer) OR
`hoveredPeerClientID === clientID`.

**Peer disconnects:** Remove from all maps/sets, clear associated timer.

### 7. Presence Update & Re-rendering

**Local cursor → presence update:**

When the user clicks, types, or navigates (arrow keys, etc.) and the cursor
position changes, call `yorkieDocStore.updateCursorPos(pos)`. Apply throttle
(~100ms) to avoid excessive updates during rapid typing.

**Remote presence → re-render:**

- `DocsView` subscribes directly to the Yorkie document's `others-changed`
  event (not through `DocStore`).
- On presence change, update label visibility state, build `PeerCursor[]`,
  and trigger `editor.render()`.
- The existing `store.onRemoteChange` callback handles document content
  changes (already wired).

### 8. Pagination Handling

- Convert peer's `DocPosition` to pixel coordinates using paginated layout.
- If the peer's cursor falls on a page that is not currently visible in the
  viewport, skip rendering entirely.
- No off-screen indicator is shown.

### 9. Testing Strategy

**Unit tests:**

- Coordinate calculation utility: verify `DocPosition` → pixel mapping for
  various block/offset combinations, including line wraps and pagination
  boundaries.
- Label visibility state: verify timer-based show/hide, hover trigger,
  peer disconnect cleanup.
- Label rendering: verify text truncation, edge-case clamping (top/right
  boundary), multi-peer stacking.

**Integration tests:**

- Verify presence update flow: cursor move → `updateCursorPos()` → presence
  change event → peer cursor rendered.

### 10. Files Changed

| File | Change |
| ---- | ------ |
| `packages/frontend/src/types/users.ts` | Add `DocsPresence` type |
| `packages/docs/src/view/doc-canvas.ts` | Accept `PeerCursor[]` param, render carets + labels |
| `packages/docs/src/view/cursor.ts` | Extract shared coordinate calculation utility |
| `packages/frontend/src/app/docs/yorkie-doc-store.ts` | Add `updateCursorPos()`, `getPresences()` (not on DocStore interface) |
| `packages/frontend/src/app/docs/docs-view.tsx` | Presence subscription, label visibility, hover detection, build PeerCursor[] |
| `packages/frontend/src/app/docs/docs-detail.tsx` | Update `initialPresence` with `DocsPresence` fields |

### 11. Phased Roadmap

| Phase | Scope | Status |
| ----- | ----- | ------ |
| Phase 1 | Cursor caret + name label | This document |
| Phase 2 | Remote selection highlight | Planned |

## Risks and Mitigation

| Risk | Mitigation |
| ---- | ---------- |
| Label overlaps document text | Transient display (4s) + hover-only |
| Invalid `blockId` from stale presence | Guard: skip rendering if block not found in layout |
| Rapid cursor movement causes presence spam | Throttle `updateCursorPos()` at ~100ms |
| Performance with many peers | Only compute/render for visible viewport; peer count typically small |
| Long usernames overflow | Truncate at 120 px with ellipsis |
| Timer leaks on rapid movement | Clear previous timer before starting new one |
| Pagination edge: cursor between pages | Use layout position to determine page; skip if not visible |
| Line-wrap affinity inaccuracy for remote cursors | Default to `'backward'`; minor visual offset acceptable for peer display |
