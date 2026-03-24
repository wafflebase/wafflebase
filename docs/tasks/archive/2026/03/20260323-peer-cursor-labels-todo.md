# Peer Cursor Name Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show transient username labels on peer cursors during collaborative editing — auto-show for 4 seconds on cell change, hover to show on demand.

**Architecture:** Extend the Store interface to include `username` in presences. Worksheet owns all visibility state (timers, hover). Overlay remains a stateless renderer that receives a `visiblePeerLabels` set and draws name tags above peer cursor cells.

**Tech Stack:** Canvas 2D rendering, TypeScript, Vitest

**Spec:** `docs/design/peer-cursor-labels.md`

---

### Task 1: Widen Store presence type to include `username`

**Files:**
- Modify: `packages/sheets/src/store/store.ts` — `getPresences()` return type
- Modify: `packages/sheets/src/model/worksheet/sheet.ts` — `getPresences()` return type

- [ ] **Step 1: Update the Store interface**

In `packages/sheets/src/store/store.ts`, change the `getPresences()` return type:

```ts
getPresences(): Array<{
  clientID: string;
  presence: { activeCell: string; username?: string };
}>;
```

- [ ] **Step 2: Update Sheet.getPresences() signature**

In `packages/sheets/src/model/worksheet/sheet.ts`, update the return type to match:

```ts
getPresences(): Array<{
  clientID: string;
  presence: { activeCell: string; username?: string };
}> {
  return this.store.getPresences();
}
```

- [ ] **Step 3: Verify typecheck passes**

Both `MemStore` and `ReadonlyStore` return `[]` which satisfies any array type — no changes needed.

```bash
pnpm sheets typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/sheets/src/store/store.ts packages/sheets/src/model/worksheet/sheet.ts
git commit -m "Widen Store.getPresences() to include optional username"
```

---

### Task 2: Add peer label rendering to Overlay

**Files:**
- Modify: `packages/sheets/src/view/overlay.ts` — render signature, peer cursor rendering, new `drawPeerLabel` helper
- Create: `packages/sheets/src/view/__tests__/overlay-peer-labels.test.ts`

- [ ] **Step 1: Write failing test for drawPeerLabel**

Create `packages/sheets/src/view/__tests__/overlay-peer-labels.test.ts`. Test `drawPeerLabel` by extracting it as an exported standalone function that takes a canvas context (mockable):

```ts
import { describe, it, expect, vi } from 'vitest';
import { drawPeerLabel } from '../overlay';

function createMockCtx() {
  return {
    font: '',
    fillStyle: '',
    textBaseline: '',
    measureText: vi.fn((text: string) => ({ width: text.length * 7 })),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe('drawPeerLabel', () => {
  it('draws username text above the cell', () => {
    const ctx = createMockCtx();
    const cellRect = { left: 100, top: 50, width: 80, height: 25 };
    const port = { left: 0, top: 0, width: 800, height: 600 };

    drawPeerLabel(ctx, 'alice', '#FF6B6B', cellRect, port, 0);

    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith('alice', expect.any(Number), expect.any(Number));
    // Tag should be above cell: y < cellRect.top
    const fillTextY = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(fillTextY).toBeLessThan(cellRect.top);
  });

  it('flips tag below cell when at top boundary', () => {
    const ctx = createMockCtx();
    const cellRect = { left: 100, top: 5, width: 80, height: 25 };
    const port = { left: 0, top: 0, width: 800, height: 600 };

    drawPeerLabel(ctx, 'bob', '#4ECDC4', cellRect, port, 0);

    const fillTextY = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(fillTextY).toBeGreaterThanOrEqual(cellRect.top + cellRect.height);
  });

  it('truncates long usernames with ellipsis', () => {
    const ctx = createMockCtx();
    // Mock measureText to return wide widths
    (ctx.measureText as ReturnType<typeof vi.fn>).mockImplementation(
      (text: string) => ({ width: text.length * 10 }),
    );
    const cellRect = { left: 100, top: 50, width: 80, height: 25 };
    const port = { left: 0, top: 0, width: 800, height: 600 };

    drawPeerLabel(ctx, 'a_very_long_username_here', '#FF6B6B', cellRect, port, 0);

    const displayedText = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(displayedText).toContain('…');
    expect(displayedText.length).toBeLessThan('a_very_long_username_here'.length);
  });
});
```

Run:
```bash
pnpm test -- --testPathPattern overlay-peer-labels
```
Expected: FAIL (`drawPeerLabel` not found)

- [ ] **Step 2: Add exported `drawPeerLabel` function to overlay.ts**

Add as an exported standalone function (not a class method) so it's testable without DOM:

```ts
export function drawPeerLabel(
  ctx: CanvasRenderingContext2D,
  username: string,
  peerColor: string,
  cellRect: BoundingRect,
  port: BoundingRect,
  stackIndex: number,
): void {
  const fontSize = 11;
  const paddingX = 4;
  const paddingY = 2;
  const maxWidth = 120;
  const radius = 2;

  ctx.font = `${fontSize}px sans-serif`;
  let displayName = username;
  let textWidth = ctx.measureText(displayName).width;

  // Truncate with ellipsis if too wide
  if (textWidth > maxWidth) {
    while (textWidth > maxWidth && displayName.length > 1) {
      displayName = displayName.slice(0, -1);
      textWidth = ctx.measureText(displayName + '…').width;
    }
    displayName += '…';
    textWidth = ctx.measureText(displayName).width;
  }

  const tagWidth = textWidth + paddingX * 2;
  const tagHeight = fontSize + paddingY * 2;

  // Position: above cell, stacked upward for multiple peers
  let x = cellRect.left;
  let y = cellRect.top - tagHeight - stackIndex * (tagHeight + 1);

  // Edge case: top boundary — flip below cell
  if (y < 0) {
    y = cellRect.top + cellRect.height + stackIndex * (tagHeight + 1);
  }

  // Edge case: right boundary clamp
  if (x + tagWidth > port.width) {
    x = port.width - tagWidth;
  }

  // Draw background with top-rounded corners
  ctx.fillStyle = peerColor;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + tagWidth - radius, y);
  ctx.arcTo(x + tagWidth, y, x + tagWidth, y + radius, radius);
  ctx.lineTo(x + tagWidth, y + tagHeight);
  ctx.lineTo(x, y + tagHeight);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
  ctx.fill();

  // Draw text
  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'top';
  ctx.fillText(displayName, x + paddingX, y + paddingY);
}
```

- [ ] **Step 3: Run test to verify it passes**

```bash
pnpm test -- --testPathPattern overlay-peer-labels
```
Expected: PASS (all 3 tests)

- [ ] **Step 4: Add `visiblePeerLabels` as last parameter of Overlay.render()**

Append after the existing last parameter (`searchCurrentIndex`):

```ts
  searchCurrentIndex?: number,
  visiblePeerLabels?: Set<string>,
) {
```

This avoids breaking any existing callers.

- [ ] **Step 5: Update `renderPeerCursorsSimple` to draw labels**

Update the method signature to accept `username` and `visiblePeerLabels`, then add label drawing after the existing stroke rect:

```ts
private renderPeerCursorsSimple(
  ctx: CanvasRenderingContext2D,
  port: BoundingRect,
  peerPresences: Array<{ clientID: string; presence: { activeCell: string; username?: string } }>,
  scroll: { left: number; top: number },
  rowDim?: DimensionIndex,
  colDim?: DimensionIndex,
  mergeData?: { anchors: Map<string, MergeSpan>; coverToAnchor: Map<string, string> },
  visiblePeerLabels?: Set<string>,
): void {
  // Group peers by cell for label stacking
  const cellPeers = new Map<string, Array<{ clientID: string; username: string; rect: BoundingRect }>>();

  for (const { clientID, presence } of peerPresences) {
    if (!presence.activeCell) continue;

    const peerActiveCell = parseRef(presence.activeCell);
    const rect = this.toCellRect(peerActiveCell, scroll, rowDim, colDim, mergeData);

    if (rect.left >= -rect.width && rect.left < port.width &&
        rect.top >= -rect.height && rect.top < port.height) {
      const peerColor = getPeerCursorColor(this.theme, clientID);
      ctx.strokeStyle = peerColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);

      // Collect visible labels for stacking
      if (visiblePeerLabels?.has(clientID) && presence.username) {
        const sref = presence.activeCell;
        if (!cellPeers.has(sref)) cellPeers.set(sref, []);
        cellPeers.get(sref)!.push({ clientID, username: presence.username, rect });
      }
    }
  }

  // Draw labels, sorted by clientID for stable ordering
  for (const peers of cellPeers.values()) {
    peers.sort((a, b) => a.clientID.localeCompare(b.clientID));
    for (let i = 0; i < peers.length; i++) {
      const { clientID, username, rect } = peers[i];
      const peerColor = getPeerCursorColor(this.theme, clientID);
      drawPeerLabel(ctx, username, peerColor, rect, port, i);
    }
  }
}
```

- [ ] **Step 6: Update freeze-pane peer cursor rendering to draw labels**

In the `render()` method's freeze-pane block (the `for (const { clientID, presence } of peerPresences)` loop), add label drawing after the existing `strokeRect`:

```ts
// After strokeRect inside the quadrant loop:
if (visiblePeerLabels?.has(clientID) && presence.username) {
  drawPeerLabel(ctx, presence.username, peerColor, rect, port, 0);
}
```

- [ ] **Step 7: Pass `visiblePeerLabels` through internal calls**

In the non-freeze branch of `render()`, update the `renderPeerCursorsSimple` call:

```ts
this.renderPeerCursorsSimple(
  ctx, port, peerPresences, scroll, rowDim, colDim, mergeData, visiblePeerLabels,
);
```

- [ ] **Step 8: Run typecheck and tests**

```bash
pnpm sheets typecheck && pnpm test
```
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/sheets/src/view/overlay.ts packages/sheets/src/view/__tests__/overlay-peer-labels.test.ts
git commit -m "Add peer cursor label rendering to Overlay

Exported drawPeerLabel function draws username tags above peer cells.
11px white text on peer-color background with truncation at 120px,
edge clamping, and stable stacking for multiple peers on same cell."
```

---

### Task 3: Add visibility state and hover detection to Worksheet

**Files:**
- Modify: `packages/sheets/src/view/worksheet.ts` — fields, methods, handleMouseMove, renderOverlay

**Important:** Add `parseRef` to the imports at the top of `worksheet.ts` (from `'../model/core/coordinates'`).

- [ ] **Step 1: Add import and peer label state fields**

Add `parseRef` to the existing import from coordinates. Add private fields to the Worksheet class:

```ts
private peerLabelTimers: Map<string, number> = new Map();
private prevPeerActiveCells: Map<string, string> = new Map();
private hoveredPeerClientID: string | null = null;
```

- [ ] **Step 2: Add `updatePeerLabelVisibility()` method**

```ts
private updatePeerLabelVisibility(): void {
  const presences = this.sheet!.getPresences();
  const currentPeerIDs = new Set<string>();

  for (const { clientID, presence } of presences) {
    if (!presence.activeCell) continue;
    currentPeerIDs.add(clientID);

    const prev = this.prevPeerActiveCells.get(clientID);
    if (prev !== presence.activeCell) {
      // Peer moved — show label with timer
      this.prevPeerActiveCells.set(clientID, presence.activeCell);

      // Clear existing timer
      const existingTimer = this.peerLabelTimers.get(clientID);
      if (existingTimer != null) {
        clearTimeout(existingTimer);
      }

      // Start new 4-second timer
      const timerId = window.setTimeout(() => {
        this.peerLabelTimers.delete(clientID);
        this.renderOverlay();
      }, 4000);
      this.peerLabelTimers.set(clientID, timerId);
    }
  }

  // Clean up disconnected peers
  for (const id of this.prevPeerActiveCells.keys()) {
    if (!currentPeerIDs.has(id)) {
      this.prevPeerActiveCells.delete(id);
      const timer = this.peerLabelTimers.get(id);
      if (timer != null) {
        clearTimeout(timer);
        this.peerLabelTimers.delete(id);
      }
    }
  }
}
```

- [ ] **Step 3: Add `getVisiblePeerLabels()` method**

```ts
private getVisiblePeerLabels(): Set<string> {
  const visible = new Set<string>();

  for (const clientID of this.peerLabelTimers.keys()) {
    visible.add(clientID);
  }

  if (this.hoveredPeerClientID) {
    visible.add(this.hoveredPeerClientID);
  }

  return visible;
}
```

- [ ] **Step 4: Update `renderOverlay()` to pass visibility state**

Add `updatePeerLabelVisibility()` call and pass `visiblePeerLabels` as the **last argument** to `overlay.render()`:

```ts
public renderOverlay() {
  this.updatePeerLabelVisibility();

  this.overlay.render(
    this.viewport,
    this.scroll,
    this.sheet!.getActiveCell(),
    this.sheet!.getPresences(),
    this.sheet!.getRanges(),
    // ... all existing parameters unchanged ...
    this._searchResults.length > 0 ? this._searchResults : undefined,
    this._searchCurrentIndex >= 0 ? this._searchCurrentIndex : undefined,
    this.getVisiblePeerLabels(),  // appended as last argument
  );
}
```

- [ ] **Step 5: Add peer cursor hover detection to `handleMouseMove()`**

Add hover detection before the final `if (changed)` block. Note: hover detection only runs when no mouse button is held and no other interactive element (resize, freeze handle, etc.) is hovered, because of early returns above. This is acceptable — labels also show on peer movement anyway.

```ts
// Peer cursor hover detection (before the final `if (changed)` block)
const hoverY = e.offsetY;
const hoverX = e.offsetX;
let newHoveredPeer: string | null = null;

if (hoverX > RowHeaderWidth && hoverY > DefaultCellHeight) {
  const mouseRow = this.toRowFromMouse(hoverY);
  const mouseCol = this.toColFromMouse(hoverX);
  const presences = this.sheet!.getPresences();
  for (const { clientID, presence } of presences) {
    if (!presence.activeCell) continue;
    const ref = parseRef(presence.activeCell);
    if (ref.r === mouseRow && ref.c === mouseCol) {
      newHoveredPeer = clientID;
      break;
    }
  }
}

if (newHoveredPeer !== this.hoveredPeerClientID) {
  this.hoveredPeerClientID = newHoveredPeer;
  this.renderOverlay();
}
```

- [ ] **Step 6: Clear hover on mouse leave**

In `handleScrollContainerMouseLeave()`, add alongside existing cleanup:

```ts
if (this.hoveredPeerClientID) {
  this.hoveredPeerClientID = null;
  // renderOverlay() will be called by the existing render path below
}
```

If the existing handler doesn't already call `render()` or `renderOverlay()`, add `this.renderOverlay()` after setting null.

- [ ] **Step 7: Run typecheck and tests**

```bash
pnpm sheets typecheck && pnpm test
```
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/sheets/src/view/worksheet.ts
git commit -m "Add peer label visibility state and hover detection

Worksheet tracks peer cell changes with 4-second timers and detects
mouse hover over peer cursor cells. Derives visiblePeerLabels set
and passes it to Overlay for rendering."
```

---

### Task 4: Integration test and cleanup

- [ ] **Step 1: Run full verify**

```bash
pnpm verify:fast
```
Expected: PASS (aside from pre-existing antlr4ts failures in frontend)

- [ ] **Step 2: Manual testing checklist**

Start the app with `pnpm dev` and open two browser tabs:

1. Move active cell in tab B → verify name tag appears in tab A above the cell
2. Wait 4+ seconds → verify tag disappears, colored border remains
3. Hover mouse over peer's cursor cell in tab A → verify tag reappears
4. Move mouse away → verify tag disappears
5. Move peer cursor to top-row cell → verify tag flips below cell
6. Move peer cursor to right-edge cell → verify tag clamps to viewport

- [ ] **Step 3: Commit any adjustments**

```bash
git add -u
git commit -m "Fix peer cursor label edge cases from integration testing"
```

- [ ] **Step 4: Verify design doc index**

```bash
grep "peer-cursor-labels" docs/design/README.md
```
Expected: line with `peer-cursor-labels.md` entry (already committed)
