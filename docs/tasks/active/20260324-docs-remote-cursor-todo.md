# Docs Remote Cursor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display remote peer cursors with name labels in the collaborative docs editor.

**Architecture:** Presence stays in the frontend layer — `YorkieDocStore` exposes `updateCursorPos()` / `getPresences()` directly (not through `DocStore`). `DocsView` subscribes to Yorkie `others-changed` events, builds a `PeerCursor[]` array, and passes it to the editor's render pipeline. `DocCanvas` renders peer carets + labels using the same coordinate system as the local cursor.

**Tech Stack:** Yorkie CRDT (presence), Canvas 2D rendering, React (DocsView component)

**Spec:** `docs/design/docs-remote-cursor.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/frontend/src/types/users.ts` | Modify | Add `DocsPresence` type |
| `packages/docs/src/view/peer-cursor.ts` | Create | `PeerCursor` type, `resolvePositionPixel()` shared utility, `drawPeerCaret()`, `drawPeerLabel()` |
| `packages/docs/src/view/cursor.ts` | Modify | Refactor `getPixelPosition()` to use shared `resolvePositionPixel()` |
| `packages/docs/src/view/doc-canvas.ts` | Modify | Accept + render `PeerCursor[]` in `render()` (outside clip region) |
| `packages/docs/src/view/editor.ts` | Modify | Add `setPeerCursors()` and `onCursorMove()` to `EditorAPI` |
| `packages/docs/src/index.ts` | Modify | Export new types |
| `packages/frontend/src/app/docs/yorkie-doc-store.ts` | Modify | Add `updateCursorPos()`, `getPresences()` |
| `packages/frontend/src/app/docs/docs-view.tsx` | Modify | Subscribe presence, manage label visibility + hover detection, pass peer cursors to editor |
| `packages/frontend/src/app/docs/docs-detail.tsx` | Modify | Add `activeCursorPos` to `initialPresence` |
| `packages/docs/src/view/__tests__/peer-cursor.test.ts` | Create | Tests for coordinate calc, label rendering, label text truncation |

---

### Task 1: Add `DocsPresence` Type

**Files:**
- Modify: `packages/frontend/src/types/users.ts`

- [ ] **Step 1: Add DocsPresence type**

```ts
// After the existing UserPresence type (line 14), add:

export type DocsPresence = {
  activeCursorPos?: {
    blockId: string;
    offset: number;
  };
} & User;
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm verify:fast`
Expected: PASS (no consumers of this type yet)

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/types/users.ts
git commit -m "Add DocsPresence type for docs remote cursor"
```

---

### Task 2: Create `peer-cursor.ts` — Shared Coordinate Utility, Types, Drawing

**Files:**
- Create: `packages/docs/src/view/peer-cursor.ts`
- Create: `packages/docs/src/view/__tests__/peer-cursor.test.ts`
- Modify: `packages/docs/src/view/cursor.ts`
- Modify: `packages/docs/src/index.ts`

Extract the coordinate calculation logic from `Cursor.getPixelPosition()`
into a shared `resolvePositionPixel()` function, then refactor the existing
`Cursor` class to use it. Add peer cursor types and Canvas drawing functions.

- [ ] **Step 1: Write failing tests**

Create `packages/docs/src/view/__tests__/peer-cursor.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { resolvePositionPixel, drawPeerCaret, drawPeerLabel } from '../peer-cursor.js';
import type { DocumentLayout } from '../layout.js';
import type { PaginatedLayout } from '../pagination.js';

function makeLayout(blocks: DocumentLayout['blocks']): DocumentLayout {
  return { blocks, totalHeight: 100 };
}

const defaultPageSetup = {
  paperSize: { name: 'A4', width: 595, height: 842 },
  orientation: 'portrait' as const,
  margins: { top: 72, bottom: 72, left: 72, right: 72 },
};

describe('resolvePositionPixel', () => {
  it('returns undefined for unknown blockId', () => {
    const layout = makeLayout([]);
    const paginated: PaginatedLayout = { pages: [], pageSetup: defaultPageSetup };
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    const result = resolvePositionPixel(
      { blockId: 'nonexistent', offset: 0 },
      'backward',
      paginated,
      layout,
      ctx,
      800,
    );
    expect(result).toBeUndefined();
  });
});

describe('drawPeerCaret', () => {
  it('draws a filled rect at the cursor position', () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const fillRectSpy = vi.spyOn(ctx, 'fillRect');

    drawPeerCaret(ctx, { x: 100, y: 200, height: 20 }, '#FF0000');

    expect(fillRectSpy).toHaveBeenCalledWith(100, 200, 2, 20);
    expect(ctx.fillStyle).toBe('#ff0000');
  });
});

describe('drawPeerLabel', () => {
  it('does not throw for a normal username', () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    expect(() => {
      drawPeerLabel(ctx, 'Alice', '#4285F4', { x: 100, y: 200, height: 20 }, 0, 800, 72);
    }).not.toThrow();
  });

  it('does not throw for a very long username', () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    expect(() => {
      drawPeerLabel(ctx, 'A'.repeat(200), '#4285F4', { x: 100, y: 200, height: 20 }, 0, 800, 72);
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --reporter=verbose packages/docs/src/view/__tests__/peer-cursor.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement `peer-cursor.ts`**

Create `packages/docs/src/view/peer-cursor.ts`:

```ts
import type { DocPosition } from '../model/types.js';
import type { PaginatedLayout } from './pagination.js';
import { findPageForPosition, getPageYOffset, getPageXOffset } from './pagination.js';
import type { DocumentLayout } from './layout.js';
import { buildFont } from './theme.js';

/**
 * Pre-processed peer cursor data for rendering.
 * Built in the frontend layer, consumed by DocCanvas.
 */
export interface PeerCursor {
  clientID: string;
  position: DocPosition;
  color: string;
  username: string;
  labelVisible: boolean;
}

/**
 * Resolved pixel position for a cursor (local or peer).
 */
export interface PositionPixel {
  x: number;
  y: number;
  height: number;
}

/**
 * Shared utility: resolve a DocPosition to pixel coordinates.
 *
 * Used by both the local Cursor class and peer cursor rendering.
 * Returns undefined if the position cannot be resolved (e.g., stale blockId).
 */
export function resolvePositionPixel(
  position: DocPosition,
  lineAffinity: 'forward' | 'backward',
  paginatedLayout: PaginatedLayout,
  layout: DocumentLayout,
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
): PositionPixel | undefined {
  const found = findPageForPosition(
    paginatedLayout,
    position.blockId,
    position.offset,
    layout,
    lineAffinity,
  );
  if (!found) return undefined;

  const { pageIndex, pageLine } = found;
  const pageX = getPageXOffset(paginatedLayout, canvasWidth);
  const pageY = getPageYOffset(paginatedLayout, pageIndex);
  const lb = layout.blocks[pageLine.blockIndex];

  // Count chars before this line
  let charsBeforeLine = 0;
  for (let li = 0; li < pageLine.lineIndex; li++) {
    for (const r of lb.lines[li].runs) {
      charsBeforeLine += r.charEnd - r.charStart;
    }
  }
  const lineOffset = position.offset - charsBeforeLine;

  let charCount = 0;
  for (const run of pageLine.line.runs) {
    const runLength = run.charEnd - run.charStart;
    if (lineOffset >= charCount && lineOffset <= charCount + runLength) {
      const localOffset = lineOffset - charCount;
      const textBefore = run.text.slice(0, localOffset);
      ctx.font = buildFont(
        run.inline.style.fontSize,
        run.inline.style.fontFamily,
        run.inline.style.bold,
        run.inline.style.italic,
      );
      const x = pageX + pageLine.x + run.x + ctx.measureText(textBefore).width;
      return { x, y: pageY + pageLine.y, height: pageLine.line.height };
    }
    charCount += runLength;
  }

  // Fallback: end of line
  const lastRun = pageLine.line.runs[pageLine.line.runs.length - 1];
  if (lastRun) {
    return {
      x: pageX + pageLine.x + lastRun.x + lastRun.width,
      y: pageY + pageLine.y,
      height: pageLine.line.height,
    };
  }
  return {
    x: pageX + pageLine.x,
    y: pageY + pageLine.y,
    height: pageLine.line.height,
  };
}

/**
 * Returns black or white text color based on background luminance.
 */
function getLabelTextColor(bgColor: string): string {
  const hex = bgColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 0.6 ? '#000000' : '#FFFFFF';
}

/**
 * Draw a peer cursor caret (colored vertical line).
 */
export function drawPeerCaret(
  ctx: CanvasRenderingContext2D,
  pixel: PositionPixel,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(pixel.x, pixel.y, 2, pixel.height);
}

/**
 * Draw a peer username label tag above (or below) the caret.
 *
 * Adapted from Sheets overlay.ts drawPeerLabel().
 * @param stackIndex - 0-based index for stacking when multiple peers
 *   share the same position.
 * @param canvasWidth - Logical canvas width for right-edge clamping.
 * @param pageTopY - Y coordinate of the page's content top margin
 *   (used to decide whether to flip the label below the caret).
 */
export function drawPeerLabel(
  ctx: CanvasRenderingContext2D,
  username: string,
  peerColor: string,
  pixel: PositionPixel,
  stackIndex: number,
  canvasWidth: number,
  pageTopY: number,
): void {
  const fontSize = 11;
  const paddingX = 4;
  const paddingY = 2;
  const maxWidth = 120;
  const radius = 2;

  ctx.font = `${fontSize}px sans-serif`;
  let displayName = username;
  let textWidth = ctx.measureText(displayName).width;

  if (textWidth > maxWidth) {
    while (textWidth > maxWidth && displayName.length > 1) {
      displayName = displayName.slice(0, -1);
      textWidth = ctx.measureText(displayName + '\u2026').width;
    }
    displayName += '\u2026';
    textWidth = ctx.measureText(displayName).width;
  }

  const tagWidth = textWidth + paddingX * 2;
  const tagHeight = fontSize + paddingY * 2;

  let x = pixel.x;
  let y = pixel.y - tagHeight - stackIndex * (tagHeight + 1);

  // Flip below caret if too close to page top
  if (y < pageTopY) {
    y = pixel.y + pixel.height + stackIndex * (tagHeight + 1);
  }
  // Clamp right edge
  if (x + tagWidth > canvasWidth) {
    x = canvasWidth - tagWidth;
  }

  // Draw rounded rectangle background
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
  ctx.fillStyle = getLabelTextColor(peerColor);
  ctx.textBaseline = 'top';
  ctx.fillText(displayName, x + paddingX, y + paddingY);
}
```

- [ ] **Step 4: Refactor `Cursor.getPixelPosition()` to use shared utility**

In `packages/docs/src/view/cursor.ts`, add import and refactor:

```ts
import { resolvePositionPixel } from './peer-cursor.js';
```

Replace the body of `getPixelPosition()` (lines 37–87) with:

```ts
  getPixelPosition(
    paginatedLayout: PaginatedLayout,
    layout: DocumentLayout,
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
  ): { x: number; y: number; height: number; visible: boolean } | undefined {
    const pixel = resolvePositionPixel(
      this.position,
      this.lineAffinity,
      paginatedLayout,
      layout,
      ctx,
      canvasWidth,
    );
    if (!pixel) return undefined;
    return { ...pixel, visible: this.visible };
  }
```

Remove the now-unused imports from cursor.ts:
- `findPageForPosition`, `getPageYOffset`, `getPageXOffset` from `'./pagination.js'`
- `buildFont` from `'./theme.js'`

Keep the `PaginatedLayout` and `DocumentLayout` type imports (still used
in the method signature).

- [ ] **Step 5: Run all tests to verify refactor didn't break anything**

Run: `pnpm test`
Expected: ALL PASS

- [ ] **Step 6: Export from package index**

In `packages/docs/src/index.ts`, add after the `Cursor` export (line 59):

```ts
export {
  type PeerCursor,
  type PositionPixel,
  resolvePositionPixel,
  drawPeerCaret,
  drawPeerLabel,
} from './view/peer-cursor.js';
```

- [ ] **Step 7: Verify typecheck**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/docs/src/view/peer-cursor.ts packages/docs/src/view/__tests__/peer-cursor.test.ts packages/docs/src/view/cursor.ts packages/docs/src/index.ts
git commit -m "Add shared position pixel utility and peer cursor rendering"
```

---

### Task 3: Integrate Peer Cursors into DocCanvas and Editor

**Files:**
- Modify: `packages/docs/src/view/doc-canvas.ts`
- Modify: `packages/docs/src/view/editor.ts`

Wire the peer cursor rendering into the existing Canvas paint pipeline.
Peer labels are drawn **outside** the page content clip region so they
are not clipped when positioned above the content area.

- [ ] **Step 1: Add `peerCursors` parameter to `DocCanvas.render()`**

In `packages/docs/src/view/doc-canvas.ts`, add import:

```ts
import { drawPeerCaret, drawPeerLabel } from './peer-cursor.js';
```

Update the `render()` signature (line 28–36) to accept peer cursors:

```ts
render(
  paginatedLayout: PaginatedLayout,
  scrollY: number,
  canvasWidth: number,
  viewportHeight: number,
  cursor?: { x: number; y: number; height: number; visible: boolean },
  selectionRects?: Array<{ x: number; y: number; width: number; height: number }>,
  focused: boolean = true,
  peerCursors?: Array<{
    pixel: { x: number; y: number; height: number };
    color: string;
    username: string;
    labelVisible: boolean;
    stackIndex: number;
  }>,
): void {
```

- [ ] **Step 2: Add peer cursor rendering AFTER the page content clip region**

In `DocCanvas.render()`, add peer cursor rendering **after** the
`this.ctx.restore()` call that ends the content clip (line 109), but still
inside the page loop. This ensures carets are clipped to the content area
but labels can extend above/below:

```ts
      // --- existing line 109: this.ctx.restore() ---

      // Draw peer cursors on this page (after clip restore so labels aren't clipped)
      if (peerCursors) {
        const pageTop = pageY + margins.top;
        const pageBottom = pageY + margins.top + contentHeight;
        for (const peer of peerCursors) {
          if (peer.pixel.y >= pageTop && peer.pixel.y < pageBottom) {
            // Clip only the caret to content area
            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.rect(contentX, contentY, contentWidth, contentHeight);
            this.ctx.clip();
            drawPeerCaret(this.ctx, peer.pixel, peer.color);
            this.ctx.restore();

            // Draw label unclipped
            if (peer.labelVisible) {
              drawPeerLabel(
                this.ctx,
                peer.username,
                peer.color,
                peer.pixel,
                peer.stackIndex,
                canvasWidth,
                pageTop,
              );
            }
          }
        }
      }
```

- [ ] **Step 3: Add `setPeerCursors()` and `onCursorMove()` to `EditorAPI`**

In `packages/docs/src/view/editor.ts`:

Add import at top:

```ts
import { type PeerCursor, resolvePositionPixel } from './peer-cursor.js';
```

Add to `EditorAPI` interface (after `setTheme`, line 36):

```ts
  /** Update peer cursor data and re-render */
  setPeerCursors(cursors: PeerCursor[]): void;
  /** Register a callback for cursor position changes */
  onCursorMove(cb: (pos: { blockId: string; offset: number }) => void): void;
  /** Get last-computed peer cursor pixel positions (for hover hit-testing) */
  getPeerCursorPixels(): Array<{ clientID: string; x: number; y: number; height: number }>;
```

Add state variables after `let dragGuideline` (line 91):

```ts
  let peerCursors: PeerCursor[] = [];
  let cursorMoveCallback: ((pos: { blockId: string; offset: number }) => void) | null = null;
  let lastPeerPixels: Array<{ clientID: string; x: number; y: number; height: number }> = [];
```

In the `paint()` function, before the `docCanvas.render()` call (line 182),
compute peer pixel positions with stacking:

```ts
    // Compute peer cursor pixel positions with stacking
    const peerPixels: Array<{
      clientID: string;
      pixel: { x: number; y: number; height: number };
      color: string;
      username: string;
      labelVisible: boolean;
      clientKey: string;
    }> = [];
    for (const peer of peerCursors) {
      const pixel = resolvePositionPixel(
        peer.position,
        'backward',
        paginatedLayout,
        layout,
        docCanvas.getContext(),
        canvasWidth,
      );
      if (pixel) {
        peerPixels.push({
          clientID: peer.clientID,
          pixel,
          color: peer.color,
          username: peer.username,
          labelVisible: peer.labelVisible,
          clientKey: `${Math.round(pixel.x)},${Math.round(pixel.y)}`,
        });
      }
    }

    // Store resolved pixels for hover hit-testing
    lastPeerPixels = peerPixels.map((p) => ({
      clientID: p.clientID,
      x: p.pixel.x,
      y: p.pixel.y,
      height: p.pixel.height,
    }));

    // Compute stacking indices for peers at the same position
    const stackCounts = new Map<string, number>();
    const resolvedPeers = peerPixels.map((p) => {
      const count = stackCounts.get(p.clientKey) ?? 0;
      stackCounts.set(p.clientKey, count + 1);
      return {
        pixel: p.pixel,
        color: p.color,
        username: p.username,
        labelVisible: p.labelVisible,
        stackIndex: count,
      };
    });
```

Update the `docCanvas.render()` call (line 182) to pass peers:

```ts
    docCanvas.render(paginatedLayout, scrollY, canvasWidth, height, cursorPixel ?? undefined, selectionRects, focused, resolvedPeers);
```

Modify `renderWithScroll` (line 283–286) to fire cursor callback:

```ts
  const renderWithScroll = () => {
    needsScrollIntoView = true;
    render();
    cursorMoveCallback?.(cursor.position);
  };
```

Add implementations in the return object:

```ts
    setPeerCursors: (cursors: PeerCursor[]) => {
      peerCursors = cursors;
      renderPaintOnly();
    },
    onCursorMove: (cb) => {
      cursorMoveCallback = cb;
    },
    getPeerCursorPixels: () => lastPeerPixels,
```

Update `dispose` to clean up:

```ts
    dispose: () => {
      peerCursors = [];
      cursorMoveCallback = null;
      lastPeerPixels = [];
      ruler.dispose();
      // ...existing cleanup
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/view/doc-canvas.ts packages/docs/src/view/editor.ts
git commit -m "Integrate peer cursor rendering into Canvas pipeline"
```

---

### Task 4: Add Presence Methods to `YorkieDocStore`

**Files:**
- Modify: `packages/frontend/src/app/docs/yorkie-doc-store.ts`
- Modify: `packages/frontend/src/app/docs/docs-detail.tsx`

Add `updateCursorPos()` and `getPresences()` methods to `YorkieDocStore`.
These are NOT on the `DocStore` interface — they are frontend-layer methods.

- [ ] **Step 1: Add presence methods to YorkieDocStore**

At the end of the `YorkieDocStore` class in
`packages/frontend/src/app/docs/yorkie-doc-store.ts`, add:

```ts
  /**
   * Update this client's cursor position in Yorkie presence.
   * Called from DocsView when the local cursor moves.
   */
  updateCursorPos(pos: { blockId: string; offset: number } | null): void {
    this.doc.update((_, p) => {
      p.set({ activeCursorPos: pos ?? undefined });
    });
  }

  /**
   * Get other peers' presences (cursor positions + user info).
   */
  getPresences(): Array<{
    clientID: string;
    presence: {
      activeCursorPos?: { blockId: string; offset: number };
      username?: string;
    };
  }> {
    return this.doc.getOthersPresences();
  }
```

- [ ] **Step 2: Update initialPresence in docs-detail.tsx**

In `packages/frontend/src/app/docs/docs-detail.tsx`, update the
`initialPresence` (around line 178–182) to include cursor position:

```ts
  initialPresence={{
    username: encodeURIComponent(currentUser.username),
    email: currentUser.email,
    photo: currentUser.photo || "",
    activeCursorPos: undefined,
  }}
```

- [ ] **Step 3: Verify build**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/docs/yorkie-doc-store.ts packages/frontend/src/app/docs/docs-detail.tsx
git commit -m "Add presence methods to YorkieDocStore for cursor tracking"
```

---

### Task 5: Wire DocsView — Presence, Labels, Hover, Cursor Updates

**Files:**
- Modify: `packages/frontend/src/app/docs/docs-view.tsx`

The main integration task. `DocsView` subscribes to Yorkie presence changes,
manages label visibility (timers + hover), computes `PeerCursor[]`, and
passes it to the editor. Also wires local cursor movements to presence updates.

- [ ] **Step 1: Update DocsView with full peer cursor integration**

Replace the `DocsView` component in `packages/frontend/src/app/docs/docs-view.tsx`.
Keep `ensureTree()` unchanged. Here is the complete updated component:

```tsx
import {
  initialize,
  type EditorAPI,
  type ThemeMode,
  type PeerCursor,
} from "@wafflebase/docs";
import { getPeerCursorColor } from "@wafflebase/sheets";
import { useEffect, useRef, useState, useCallback } from "react";
import { useDocument, Tree } from "@yorkie-js/react";
import { Loader } from "@/components/loader";
import { useTheme } from "@/components/theme-provider";
import type { YorkieDocsRoot } from "@/types/docs-document";
import { YorkieDocStore } from "./yorkie-doc-store";

export type { EditorAPI } from "@wafflebase/docs";

// ... keep ensureTree function unchanged ...

/** Label visibility timeout (ms). */
const LABEL_VISIBLE_DURATION = 4000;

/** Throttle interval for cursor presence updates (ms). */
const CURSOR_UPDATE_THROTTLE = 100;

/** Hover detection radius (px) around a peer caret. */
const HOVER_RADIUS = 10;

interface DocsViewProps {
  onEditorReady?: (editor: EditorAPI | null) => void;
}

export function DocsView({ onEditorReady }: DocsViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorAPI | null>(null);
  const storeRef = useRef<YorkieDocStore | null>(null);
  const [didMount, setDidMount] = useState(false);
  const { doc, loading, error } = useDocument<YorkieDocsRoot>();
  const { resolvedTheme } = useTheme();

  // Label visibility state refs (not React state — avoid re-renders)
  const peerLabelTimers = useRef<Map<string, number>>(new Map());
  const prevPeerCursorPos = useRef<Map<string, string>>(new Map());
  const visiblePeerLabels = useRef<Set<string>>(new Set());
  const hoveredPeerClientID = useRef<string | null>(null);

  // Throttle ref for cursor position updates
  const lastCursorUpdate = useRef<number>(0);

  // Prevent double-initialization in React strict mode / dev HMR.
  useEffect(() => {
    setDidMount(true);
  }, []);

  // Build PeerCursor[] from current presences + visibility state
  const buildPeerCursors = useCallback((): PeerCursor[] => {
    const store = storeRef.current;
    if (!store) return [];

    const theme = (resolvedTheme === "dark" ? "dark" : "light") as "light" | "dark";
    const presences = store.getPresences();
    return presences
      .filter((p) => p.presence.activeCursorPos)
      .map((p) => ({
        clientID: p.clientID,
        position: p.presence.activeCursorPos!,
        color: getPeerCursorColor(theme, p.clientID),
        username: p.presence.username
          ? decodeURIComponent(p.presence.username)
          : "Anonymous",
        labelVisible:
          visiblePeerLabels.current.has(p.clientID) ||
          hoveredPeerClientID.current === p.clientID,
      }));
  }, [resolvedTheme]);

  // Handle presence changes — update label timers + re-render
  const handlePresenceChange = useCallback(() => {
    const store = storeRef.current;
    const editor = editorRef.current;
    if (!store || !editor) return;

    const presences = store.getPresences();
    const currentPeerIds = new Set<string>();

    for (const { clientID, presence } of presences) {
      currentPeerIds.add(clientID);
      if (!presence.activeCursorPos) continue;

      const posKey = `${presence.activeCursorPos.blockId}:${presence.activeCursorPos.offset}`;
      const prevKey = prevPeerCursorPos.current.get(clientID);

      if (posKey !== prevKey) {
        prevPeerCursorPos.current.set(clientID, posKey);

        const existingTimer = peerLabelTimers.current.get(clientID);
        if (existingTimer) clearTimeout(existingTimer);

        visiblePeerLabels.current.add(clientID);

        const timer = window.setTimeout(() => {
          visiblePeerLabels.current.delete(clientID);
          peerLabelTimers.current.delete(clientID);
          editor.setPeerCursors(buildPeerCursors());
        }, LABEL_VISIBLE_DURATION);

        peerLabelTimers.current.set(clientID, timer);
      }
    }

    // Clean up disconnected peers
    for (const clientID of [...prevPeerCursorPos.current.keys()]) {
      if (!currentPeerIds.has(clientID)) {
        prevPeerCursorPos.current.delete(clientID);
        visiblePeerLabels.current.delete(clientID);
        const timer = peerLabelTimers.current.get(clientID);
        if (timer) clearTimeout(timer);
        peerLabelTimers.current.delete(clientID);
      }
    }

    editor.setPeerCursors(buildPeerCursors());
  }, [buildPeerCursors]);

  useEffect(() => {
    const container = containerRef.current;
    if (!didMount || !container || !doc) return;
    if (!ensureTree(doc)) return;

    const store = new YorkieDocStore(doc);
    storeRef.current = store;
    const theme = (resolvedTheme === "dark" ? "dark" : "light") as ThemeMode;
    const editor: EditorAPI = initialize(container, store, theme);
    editorRef.current = editor;
    onEditorReady?.(editor);

    // Re-render on remote document changes
    store.onRemoteChange = () => {
      editor.getDoc().refresh();
      editor.render();
    };

    // Subscribe to presence changes
    const unsubPresence = doc.subscribe("others", () => {
      handlePresenceChange();
    });

    // Wire local cursor → presence updates (throttled)
    editor.onCursorMove((pos) => {
      const now = Date.now();
      if (now - lastCursorUpdate.current < CURSOR_UPDATE_THROTTLE) return;
      lastCursorUpdate.current = now;
      store.updateCursorPos(pos);
    });

    // Hover detection: show peer label when mouse is near a peer caret
    const handleMouseMove = (e: MouseEvent) => {
      const ed = editorRef.current;
      if (!ed) return;

      const containerRect = container.getBoundingClientRect();
      const mouseX = e.clientX - containerRect.left;
      const mouseY = e.clientY - containerRect.top + container.scrollTop;

      // Use last-computed peer pixel positions from the editor
      const peerPixels = ed.getPeerCursorPixels();
      let newHoveredID: string | null = null;

      for (const peer of peerPixels) {
        if (
          Math.abs(mouseX - peer.x) < HOVER_RADIUS &&
          mouseY >= peer.y - HOVER_RADIUS &&
          mouseY <= peer.y + peer.height + HOVER_RADIUS
        ) {
          newHoveredID = peer.clientID;
          break;
        }
      }

      if (newHoveredID !== hoveredPeerClientID.current) {
        hoveredPeerClientID.current = newHoveredID;
        ed.setPeerCursors(buildPeerCursors());
      }
    };

    container.addEventListener("mousemove", handleMouseMove);

    return () => {
      for (const timer of peerLabelTimers.current.values()) {
        clearTimeout(timer);
      }
      peerLabelTimers.current.clear();
      prevPeerCursorPos.current.clear();
      visiblePeerLabels.current.clear();
      hoveredPeerClientID.current = null;

      container.removeEventListener("mousemove", handleMouseMove);
      unsubPresence();
      editor.dispose();
      editorRef.current = null;
      storeRef.current = null;
      onEditorReady?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [didMount, doc]);

  // Update the editor theme when the user toggles light/dark mode.
  useEffect(() => {
    if (editorRef.current) {
      const mode = (resolvedTheme === "dark" ? "dark" : "light") as ThemeMode;
      editorRef.current.setTheme(mode);
      editorRef.current.setPeerCursors(buildPeerCursors());
    }
  }, [resolvedTheme, buildPeerCursors]);

  if (loading) return <Loader />;

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-red-500">{error.message}</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative flex-1 w-full min-h-0" />
  );
}

export default DocsView;
```

- [ ] **Step 2: Verify the full integration builds**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/app/docs/docs-view.tsx packages/docs/src/view/editor.ts packages/docs/src/view/peer-cursor.ts
git commit -m "Wire DocsView presence subscription, label visibility, and hover"
```

---

### Task 6: Manual Testing and Polish

**Files:**
- Potentially tweak any of the above files

This task verifies the feature end-to-end with two browser windows.

- [ ] **Step 1: Start dev environment**

Run: `docker compose up -d && pnpm dev`

- [ ] **Step 2: Open a docs document in two browser tabs**

1. Navigate to the same docs document in both tabs.
2. In tab A, type some text and move the cursor around.
3. Verify in tab B that a colored caret appears at tab A's cursor position.
4. Verify the username label appears for ~4 seconds, then disappears.
5. Hover over the peer caret in tab B — verify the label reappears.

- [ ] **Step 3: Test edge cases**

- Move cursor to the top of a page — verify label flips below.
- Move cursor near the right edge — verify label clamps.
- Disconnect one tab — verify the peer cursor disappears.
- Type rapidly — verify no performance issues (throttle working).

- [ ] **Step 4: Run verification**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 5: Final commit if any polish changes were made**

```bash
git add -A
git commit -m "Polish docs remote cursor rendering"
```
