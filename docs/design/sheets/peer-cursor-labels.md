---
title: peer-cursor-labels
target-version: 0.2.0
---

# Peer Cursor Name Labels

## Summary

Show a name label on peer cursors during collaborative editing so users can
identify who is working where. Labels appear temporarily when a peer moves
to a new cell and on mouse hover, keeping the canvas uncluttered while
still providing identity information on demand.

## Goals / Non-Goals

### Goals

- Display the peer's username above their active cell as a small tag.
- Auto-show the tag for ~4 seconds when a peer moves to a new cell.
- Show the tag while the local user hovers over a peer's active cell.
- Keep cell content readable — the tag is transient, not permanent.
- Work correctly with frozen panes and viewport edge cases.

### Non-Goals

- Avatar or profile picture in the tag.
- Animated fade-in / fade-out transitions (may add later).
- Showing the tag for the local user's own cursor.

## Proposal Details

### 1. Tag Visual Style

The tag is drawn on the overlay canvas, directly above the peer's active
cell border.

| Property       | Value                                           |
| -------------- | ----------------------------------------------- |
| Position       | Top-left of cell, offset upward (outside)       |
| Background     | Peer cursor color (opaque)                      |
| Text color     | White (`#FFFFFF`)                                |
| Font           | 10–11 px sans-serif                             |
| Padding        | 4 px horizontal, 2 px vertical                  |
| Border radius  | 2 px on top corners only                        |
| Content        | `username`, truncated with ellipsis at 120 px   |
| Max width      | 120 px (logical, pre-zoom)                      |

All size values are logical pixels that scale automatically with the
existing `ctx.scale(ratio * zoom, ...)` transform.

### 2. Store Interface Change

The current `Store.getPresences()` returns:

```ts
Array<{ clientID: string; presence: { activeCell: string } }>
```

To render the username, the presence type must be widened:

```ts
Array<{ clientID: string; presence: { activeCell: string; username?: string } }>
```

`username` is optional so that `MemStore` and `ReadOnlyStore` can return
presences without it (label simply won't render).

**Affected files:**

| File | Change |
| ---- | ------ |
| `packages/sheets/src/store/store.ts` | Add `username?` to presence type |
| `packages/sheets/src/store/memory.ts` | Satisfy updated interface |
| `packages/sheets/src/store/readonly.ts` | Satisfy updated interface |
| `packages/frontend/src/app/spreadsheet/yorkie-store.ts` | Already has username — ensure it passes through |

### 3. Rendering (overlay.ts)

Extend `renderPeerCursorsSimple` and `renderPeerCursorsFreeze`:

1. After drawing the 2 px stroke rect for a peer, check if that peer's
   label should be visible via `visiblePeerLabels` (see §4).
2. If visible, measure the username text width with `ctx.measureText`.
   If wider than 120 px, truncate with ellipsis.
3. Compute the tag rect:
   - `x = cellRect.left`
   - `y = cellRect.top - tagHeight`
   - `width = textWidth + paddingX * 2`
   - `height = fontSize + paddingY * 2`
4. Apply edge-case adjustments (see §6).
5. Fill the rounded-rect background with the peer cursor color.
6. Draw the username with `ctx.fillText`.

The freeze-pane variant applies the same logic inside each quadrant's
clipping region.

`Overlay` remains a stateless renderer — it receives visibility data as a
parameter and does not own timers or mutable state.

### 4. Visibility State (worksheet.ts)

`Worksheet` owns all label visibility state, consistent with its existing
role as the interaction state manager.

```ts
peerLabelTimers: Map<string, number>          // clientID → setTimeout id
prevPeerActiveCells: Map<string, string>      // clientID → previous sref
hoveredPeerClientID: string | null
```

`Worksheet` derives a `visiblePeerLabels: Map<string, string>` (clientID →
username) and passes it to `Overlay.render()`.

**Trigger: peer moves to a new cell**

On each render call, compare the current `activeCell` of each peer with
`prevPeerActiveCells`. If different:

1. Clear any existing timer for that peer.
2. Add the peer to `visiblePeerLabels`.
3. Start a new `setTimeout` (~4 seconds). On expiry, remove from
   `visiblePeerLabels` and call `renderOverlay()`.
4. Update `prevPeerActiveCells`.

**Trigger: local mouse hover**

When `hoveredPeerClientID` is set (see §5), that peer is added to
`visiblePeerLabels` regardless of the timer state.

**Label visible when:** peer has an active timer OR
`hoveredPeerClientID === clientID`.

### 5. Hover Detection (worksheet.ts)

In the existing `mousemove` handler (note: this handler early-returns when
a mouse button is held, so hover labels only appear with no button
pressed — this is acceptable):

1. Convert mouse coordinates to cell coordinates (row, col) using
   existing viewport → cell mapping.
2. Iterate over `peerPresences`. If any peer's `activeCell` matches the
   hovered cell, set `hoveredPeerClientID` to that peer's `clientID`.
3. If no match, clear `hoveredPeerClientID`.
4. If the value changed, request an overlay re-render.

No bounding-rect hit-test is needed — cell-level comparison is sufficient.

### 6. Edge Cases

**Top boundary:** If `cellRect.top - tagHeight < viewport.top`, draw the
tag below the cell instead (`y = cellRect.top + cellRect.height`).

**Left boundary:** If `x < viewport.left`, clamp `x = viewport.left`.

**Right boundary:** If `x + tagWidth > viewport.right`, clamp
`x = viewport.right - tagWidth`.

**Multiple peers on the same cell:** Stack tags vertically upward, each
offset by `tagHeight + 1 px` gap. Sort by `clientID` for stable ordering
to avoid label jitter when peers appear/disappear.

**Freeze panes:** Render within each quadrant's clip region using the
same logic as `renderPeerCursorsFreeze`.

**Peer leaves / disconnects:** Remove entry from `peerLabelTimers` and
`prevPeerActiveCells` when the peer is no longer in the presences list.
Clear any associated timer.

### 7. Files Changed

| File | Change |
| ---- | ------ |
| `packages/sheets/src/store/store.ts` | Add `username?` to presence type |
| `packages/sheets/src/store/memory.ts` | Satisfy updated interface |
| `packages/sheets/src/store/readonly.ts` | Satisfy updated interface |
| `packages/sheets/src/view/overlay.ts` | Tag rendering (stateless) |
| `packages/sheets/src/view/worksheet.ts` | Visibility state, hover detection, timer management |
| `packages/frontend/src/app/spreadsheet/yorkie-store.ts` | Pass username through presences |

## Risks and Mitigation

| Risk | Mitigation |
| ---- | ---------- |
| Tag overlaps important cell content | Transient display (4 s) + hover-only — not persistent |
| Many peers on same cell create tall stack | Unlikely in practice; cap at 3–4 visible tags if needed |
| Timer leaks on rapid cell changes | Clear previous timer before starting new one |
| Performance with many peers | Only measure/draw text for visible labels; peer count is typically small |
| Long usernames overflow viewport | Truncate at 120 px with ellipsis |
| Timer fires in background tab | Minor — triggers one unnecessary render; acceptable |
