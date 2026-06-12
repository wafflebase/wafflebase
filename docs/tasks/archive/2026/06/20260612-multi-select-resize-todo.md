# Multi-Select Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the eight resize handles to behave for `selectedIds.length > 1`, with Google Slides / PowerPoint parity (per-child bbox-relative scale, type dispatch including connectors, single batched undo). Unify the resize live-preview paint behind one `paintGhostPreview` helper so every resize / rotate path uses the same `GHOST_ALPHA` ghost-on-top pattern as move and single-table-resize.

**Architecture:** New pure function `resizeMultiFrames` in `interactions/resize.ts` computes the new bbox via existing `resizeFrame` and redistributes per-child frames via a `mapPoint` closure. `startResize` drops its `length !== 1` guard and routes `> 1` through the new function. Existing single-resize math (`resizeFrame` / `resizeFrameWorld` / table cell scaling) is unchanged; only its paint path migrates from `paintLiveScoped` to `paintGhostPreview`. `paintMoveGhost` is renamed to `paintGhostPreview` and gains a clear semantic: callers choose handle anchor via the second argument (`originals` for move/rotate, `ghosts` for resize). Multi-rotate is already wired in `startRotate` (the `isMulti` branch); we only follow the rename through and optionally extract `rotateMultiFrames` for symmetry.

**Tech Stack:** TypeScript, Vitest (unit + editor integration), DOM-based visual harness scenarios under `packages/frontend/src/app/harness/visual/`.

---

## File Structure

| File | Role | Change |
|---|---|---|
| `packages/slides/src/view/editor/interactions/resize.ts` | Resize math (pure) | Add `resizeMultiFrames`; existing `resizeFrame` / `resizeFrameWorld` unchanged |
| `packages/slides/test/view/editor/interactions/resize.test.ts` | Unit tests for resize math | Add `resizeMultiFrames` cases (rotated child, connector endpoints, min-size clamp) |
| `packages/slides/src/view/editor/editor.ts` | Editor wiring | Rename `paintMoveGhost` → `paintGhostPreview`; migrate `startResize` single non-table call site off `paintLiveScoped`; remove `length !== 1` guard; add `> 1` branch |
| `packages/slides/test/view/editor/editor.test.ts` | Editor integration | New cases for multi-resize commit (2-shape, group + shape, connector attached) |
| `packages/slides/test/view/editor/interactions/multi-resize.test.ts` | New file | Heavier integration cases per spec §9 (drilled-in scope, all endpoints attached, single batched undo) |
| `packages/frontend/src/app/harness/visual/slides-scenarios.tsx` | Visual scenarios | Add "multi-select resize", "multi-select rotate" (already shipped but no scenario), "resize ghost mid-drag", "multi-resize ghost mid-drag" |

---

## Task 1: Characterization tests for the current behavior

Pin the existing single-resize behavior down with a unit baseline before the paint path migrates, so any regression on the `resizeFrame` math is visible. Also pin the current "multi-resize is a no-op" behavior with a single editor test that we will flip in Task 4.

**Files:**
- Test: `packages/slides/test/view/editor/interactions/resize.test.ts`
- Test: `packages/slides/test/view/editor/editor.test.ts`

- [x] **Step 1: Read the existing `resize.test.ts` to confirm conventions**

Run: `rg -n "describe|it\(" packages/slides/test/view/editor/interactions/resize.test.ts | head -30`
Expected: A list of existing `describe` / `it` blocks. Match style for new cases (vitest `describe`/`it`, ESM imports).

- [x] **Step 2: Add a no-op multi-resize regression test**

File: `packages/slides/test/view/editor/editor.test.ts`

Append at the end of the file, inside the main `describe`:

```ts
it('multi-select SE-handle drag is currently a no-op (baseline; flipped in multi-resize task)', async () => {
  const { editor, slide, store } = createEditorWithElements([
    makeRect('a', { x: 0,   y: 0,   w: 100, h: 50 }),
    makeRect('b', { x: 200, y: 100, w: 80,  h: 60 }),
  ]);
  editor.selection.set(['a', 'b']);
  editor.render();

  const before = store.read().slides[0].elements.map((e) => ({ id: e.id, frame: e.frame }));
  // Simulate a drag on the SE handle (offset from the bbox's SE corner).
  await dragHandle(editor, 'se', { dx: 40, dy: 30 });
  const after  = store.read().slides[0].elements.map((e) => ({ id: e.id, frame: e.frame }));

  expect(after).toEqual(before); // no frames updated — startResize early-returns today
});
```

If `createEditorWithElements`, `makeRect`, or `dragHandle` do not exist in the suite, look at the nearest existing test using the same helpers (e.g. `it('drags the SE handle...')`) and inline the equivalent setup. Do **not** create new helpers in this task — keep the baseline test self-contained if the helpers are missing.

- [x] **Step 3: Run the baseline**

Run: `pnpm --filter @wafflebase/slides test -- view/editor/editor.test.ts`
Expected: PASS for the new test (baseline = no-op).

- [x] **Step 4: Commit**

```bash
git add packages/slides/test/view/editor/editor.test.ts
git commit -m "$(cat <<'EOF'
Pin multi-resize current no-op behavior in editor.test.ts

Baseline test asserts that a multi-selection SE-handle drag does not
mutate any frame today (startResize early-returns on length !== 1).
The follow-up multi-resize task flips this expectation to verify the
new per-child scaling path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Rename `paintMoveGhost` → `paintGhostPreview`

Pure rename. No behavior change. Splits cleanly out so the migration in later tasks is easy to read.

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts` — line 4529 (definition), line 4335 (move call site), line 5171 (rotate call site)

- [x] **Step 1: Rename the method definition**

In `editor.ts`, change:

```ts
  private paintMoveGhost(
    ghosts: readonly Element[],
    selectedOriginals: readonly Element[],
    guides: readonly (SnapGuide | SmartGuide)[] = [],
  ): void {
```

to:

```ts
  /**
   * Live-preview paint shared by move, rotate, and resize:
   * - Renders the committed slide at full opacity.
   * - Overlays `ghosts` at `GHOST_ALPHA`.
   * - Anchors selection handles to `handleElements` — pass `ghosts`
   *   for resize (the dragged handle must follow the cursor), pass
   *   the originals for move and rotate (the gesture is by direction,
   *   not position).
   */
  private paintGhostPreview(
    ghosts: readonly Element[],
    handleElements: readonly Element[],
    guides: readonly (SnapGuide | SmartGuide)[] = [],
  ): void {
```

The body is unchanged. Rename the inner reference `selectedOriginals` → `handleElements` to match the new parameter name (it is only used inside `renderOverlay(this.options.overlay, selectedOriginals, {...})` → `renderOverlay(this.options.overlay, handleElements, {...})`).

- [x] **Step 2: Update the two call sites**

At line 4335 (move drag): `this.paintMoveGhost(ghosts, handleElements, guides);` → `this.paintGhostPreview(ghosts, handleElements, guides);`

At line 5171 (rotate drag): `this.paintMoveGhost(ghosts, handleElements);` → `this.paintGhostPreview(ghosts, handleElements);`

The doc-comment of `paintTableResizeGhost` references `paintMoveGhost` in prose (line 4471). Update that string to `paintGhostPreview`.

- [x] **Step 3: Run type-check + tests**

Run: `pnpm --filter @wafflebase/slides build && pnpm --filter @wafflebase/slides test`
Expected: PASS. Type-check confirms no remaining `paintMoveGhost` references.

- [x] **Step 4: Commit**

```bash
git add packages/slides/src/view/editor/editor.ts
git commit -m "$(cat <<'EOF'
Rename paintMoveGhost to paintGhostPreview

The helper is shared by move, single-rotate, and (in follow-up tasks)
all resize paths. The new name describes the function, not the only
caller it had at introduction. Second argument is renamed to
`handleElements` so its semantic — "where the handles render" — is
explicit at call sites; callers pass the originals for move/rotate
and the ghosts for resize.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Migrate single non-table resize to `paintGhostPreview`

Single non-table resize currently uses `paintLiveScoped`, which patches the synthetic slide and renders the element in place. Migrate it so the committed original stays visible and a `GHOST_ALPHA` ghost paints on top (handles on ghost).

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts` — line 5325-5357 (`startResize`'s `onMove`)

- [x] **Step 1: Replace the non-table paint call**

In `startResize`'s `onMove`, the current end is:

```ts
      if (isTable) {
        this.paintTableResizeGhost(
          startEl as TableElement,
          live.worldFrame,
          scope,
          matched.guides,
        );
        return;
      }
      const livMap = new Map<string, Frame>([[elementId, live.worldFrame]]);
      this.paintLiveScoped(livMap, scope, matched.guides);
```

Replace the post-`if (isTable)` block with:

```ts
      if (isTable) {
        this.paintTableResizeGhost(
          startEl as TableElement,
          live.worldFrame,
          scope,
          matched.guides,
        );
        return;
      }
      // Single non-table resize: paint a ghost of the element at its new
      // world frame on top of the committed slide. Handles render against
      // the ghost so the dragged handle stays under the cursor.
      const ghost: Element = { ...startEl, frame: live.worldFrame } as Element;
      this.paintGhostPreview([ghost], [ghost], matched.guides);
```

Drop the `livMap` local; it is no longer used here.

- [x] **Step 2: Update the trailing-comment line reference**

Just below `onUp`, the comment reads:

```ts
      // Clear lingering equal-size dashed outlines from the last
      // paintLiveScoped guides arg. Mirrors the move-drag onUp at ~line 2568.
```

Replace `paintLiveScoped` with `paintGhostPreview`:

```ts
      // Clear lingering equal-size dashed outlines from the last
      // paintGhostPreview guides arg. Mirrors the move-drag onUp at ~line 2568.
```

- [x] **Step 3: Run tests**

Run: `pnpm --filter @wafflebase/slides test`
Expected: PASS for all existing tests. Single-resize unit + integration tests assert frames at commit (not paint pixels), so they remain green.

- [x] **Step 4: Spot-check in the dev server**

Run: `pnpm dev`
Manually: open a slide, single-select a shape, drag the SE handle. Confirm the original stays at full opacity, a translucent copy appears at the new size, and on release the original snaps to the new size with no flicker.

- [x] **Step 5: Commit**

```bash
git add packages/slides/src/view/editor/editor.ts
git commit -m "$(cat <<'EOF'
Use ghost-on-top preview for single non-table resize

Single resize previously rendered the element in place via
paintLiveScoped, which made the gesture feel like direct mutation.
Move, single-rotate, and single-table-resize all use the
ghost-on-original pattern; this aligns single non-table resize with
that convention. Handles render against the ghost (resize semantics:
the dragged handle must follow the cursor), matching the existing
paintTableResizeGhost call.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add `resizeMultiFrames` pure function (TDD)

The core math: given a start bbox, snapshots, handle, and pointer delta, return the new bbox + per-child world frames + connector free-endpoint world positions.

**Files:**
- Test: `packages/slides/test/view/editor/interactions/resize.test.ts`
- Create: extension of `packages/slides/src/view/editor/interactions/resize.ts`

- [x] **Step 1: Read existing imports + types in `resize.ts`**

Run: `rg -n "^import|^export" packages/slides/src/view/editor/interactions/resize.ts`
Expected: Confirms `import type { Frame } from '../../../model/element';` and exported `resizeFrame`, `resizeFrameWorld`, `ResizeHandle`.

- [x] **Step 2: Add the failing test for the simplest case (two unrotated rects, SE, no Shift)**

File: `packages/slides/test/view/editor/interactions/resize.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  resizeMultiFrames,
  type MultiResizeStart,
} from '../../../../src/view/editor/interactions/resize';
import type { Endpoint } from '../../../../src/model/connector';

const frameSnap = (id: string, x: number, y: number, w: number, h: number, rotation = 0) => ({
  kind: 'frame' as const,
  id,
  worldFrame: { x, y, w, h, rotation },
});

describe('resizeMultiFrames', () => {
  it('SE corner, no Shift: scales both axes independently per child', () => {
    const snapshots = [
      frameSnap('a', 0,   0,   100, 50),
      frameSnap('b', 200, 100, 80,  60),
    ];
    const startBbox = { x: 0, y: 0, w: 280, h: 160, rotation: 0 };
    const start: MultiResizeStart = {
      scope: [],
      startBbox,
      snapshots,
    };
    const { newBbox, frames } = resizeMultiFrames(start, 'se', 280, 160, false);

    // newBbox doubles in both dims (sx = sy = 2).
    expect(newBbox).toMatchObject({ x: 0, y: 0, w: 560, h: 320 });
    // 'a' anchored at NW (bbox anchor for SE handle is NW corner): center (50,25) → (100,50); w/h doubled.
    expect(frames.get('a')).toMatchObject({ x: 0, y: 0, w: 200, h: 100 });
    // 'b' center (240, 130) → (480, 260); w*=2, h*=2.
    expect(frames.get('b')).toMatchObject({ x: 400, y: 200, w: 160, h: 120 });
  });
});
```

- [x] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test -- interactions/resize.test.ts`
Expected: FAIL — `resizeMultiFrames` is not exported from `resize.ts`.

- [x] **Step 4: Implement the minimum to pass**

In `packages/slides/src/view/editor/interactions/resize.ts`, append:

```ts
import type { Endpoint } from '../../../model/connector';

export type ElementSnapshot =
  | { kind: 'frame'; id: string; worldFrame: Frame }
  | {
      kind: 'connector';
      id: string;
      worldFrame: Frame;
      start: Endpoint;
      end: Endpoint;
    };

export interface MultiResizeStart {
  scope: readonly string[];
  startBbox: Frame; // rotation === 0
  snapshots: readonly ElementSnapshot[];
}

export interface MultiResizeResult {
  newBbox: Frame;
  frames: Map<string, Frame>;
  connectorEndpoints: Map<string, { start: Endpoint; end: Endpoint }>;
}

/**
 * Pure multi-resize math. Reuses `resizeFrame` for the bbox (it is
 * always axis-aligned) and redistributes the new dimensions over
 * per-child frames via a single affine map: a child's centre and
 * size scale by (sx, sy) relative to the bbox anchor. Rotation is
 * preserved per child (Google Slides / PowerPoint behaviour). Each
 * child's `w` / `h` is clamped to `MIN_SIZE`.
 */
export function resizeMultiFrames(
  start: MultiResizeStart,
  handle: ResizeHandle,
  worldDx: number,
  worldDy: number,
  shift: boolean,
): MultiResizeResult {
  const newBbox = resizeFrame(start.startBbox, handle, worldDx, worldDy, shift);
  const sx = start.startBbox.w > 0 ? newBbox.w / start.startBbox.w : 1;
  const sy = start.startBbox.h > 0 ? newBbox.h / start.startBbox.h : 1;

  const mapPoint = (px: number, py: number): { x: number; y: number } => ({
    x: newBbox.x + (px - start.startBbox.x) * sx,
    y: newBbox.y + (py - start.startBbox.y) * sy,
  });

  const frames = new Map<string, Frame>();
  const connectorEndpoints = new Map<string, { start: Endpoint; end: Endpoint }>();

  for (const snap of start.snapshots) {
    const cx = snap.worldFrame.x + snap.worldFrame.w / 2;
    const cy = snap.worldFrame.y + snap.worldFrame.h / 2;
    const c2 = mapPoint(cx, cy);
    const w2 = Math.max(snap.worldFrame.w * sx, MIN_SIZE);
    const h2 = Math.max(snap.worldFrame.h * sy, MIN_SIZE);
    const nextFrame: Frame = {
      x: c2.x - w2 / 2,
      y: c2.y - h2 / 2,
      w: w2,
      h: h2,
      rotation: snap.worldFrame.rotation,
    };
    frames.set(snap.id, nextFrame);

    if (snap.kind === 'connector') {
      const mapEp = (ep: Endpoint): Endpoint => {
        if (ep.kind === 'attached') return ep;
        const p = mapPoint(ep.x, ep.y);
        return { kind: 'free', x: p.x, y: p.y };
      };
      const writeStart = snap.start.kind === 'free' ? mapEp(snap.start) : snap.start;
      const writeEnd   = snap.end.kind   === 'free' ? mapEp(snap.end)   : snap.end;
      // Only record an entry when at least one endpoint actually changes
      // (i.e. at least one is `free`). If both are attached, the connector
      // is a follower; we do not write to it.
      if (snap.start.kind === 'free' || snap.end.kind === 'free') {
        connectorEndpoints.set(snap.id, { start: writeStart, end: writeEnd });
      }
    }
  }

  return { newBbox, frames, connectorEndpoints };
}
```

`MIN_SIZE` is the existing module-private constant; no new import needed.

- [x] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/slides test -- interactions/resize.test.ts`
Expected: PASS.

- [x] **Step 6: Add edge-case tests, one at a time, TDD-style**

Add the following tests to the same `describe('resizeMultiFrames')` block. For each: add the test, run, watch it pass (the implementation already covers them — these are belt-and-braces) or fail (extend the impl).

```ts
it('SE corner, Shift: uniform scale based on the dominant axis', () => {
  const snapshots = [frameSnap('a', 0, 0, 100, 50)];
  const startBbox = { x: 0, y: 0, w: 100, h: 50, rotation: 0 };
  const result = resizeMultiFrames(
    { scope: [], startBbox, snapshots },
    'se',
    100, // dx grows the bbox by 2x in x
    0,   // dy unchanged
    true, // shift → uniform scale, h also doubles
  );
  expect(result.newBbox).toMatchObject({ w: 200, h: 100 });
  expect(result.frames.get('a')).toMatchObject({ w: 200, h: 100 });
});

it('W edge: single-axis stretch in x only', () => {
  const snapshots = [frameSnap('a', 100, 0, 100, 50)];
  const startBbox = { x: 100, y: 0, w: 100, h: 50, rotation: 0 };
  const result = resizeMultiFrames(
    { scope: [], startBbox, snapshots },
    'w',
    -100, // drag west handle 100 to the left → x shrinks, w grows by 100
    0,
    false,
  );
  // newBbox: x=0, w=200; h unchanged.
  expect(result.newBbox).toMatchObject({ x: 0, w: 200, h: 50 });
  expect(result.frames.get('a')).toMatchObject({ x: 0, w: 200, h: 50 });
});

it('preserves rotation on each child; w/h scale in local axes', () => {
  const snapshots = [
    frameSnap('a', 0, 0, 100, 50, Math.PI / 4),
  ];
  // For a rotated child, startBbox is the child's own AABB after rotation —
  // we test that rotation is preserved and dimensions scale in local axes.
  const startBbox = { x: 0, y: 0, w: 100, h: 50, rotation: 0 };
  const result = resizeMultiFrames(
    { scope: [], startBbox, snapshots },
    'se', 100, 50, false,
  );
  const a = result.frames.get('a')!;
  expect(a.rotation).toBeCloseTo(Math.PI / 4);
  expect(a.w).toBeCloseTo(200);
  expect(a.h).toBeCloseTo(100);
});

it('connector free endpoints scale; attached endpoints are unchanged', () => {
  const snapshots: ElementSnapshot[] = [
    {
      kind: 'connector',
      id: 'c',
      worldFrame: { x: 0, y: 0, w: 100, h: 50, rotation: 0 },
      start: { kind: 'free', x: 0, y: 0 },
      end:   { kind: 'attached', elementId: 'target', siteIndex: 0 },
    },
  ];
  const startBbox = { x: 0, y: 0, w: 100, h: 50, rotation: 0 };
  const result = resizeMultiFrames(
    { scope: [], startBbox, snapshots },
    'se', 100, 50, false,
  );
  const eps = result.connectorEndpoints.get('c')!;
  expect(eps.start).toEqual({ kind: 'free', x: 0, y: 0 }); // NW is the anchor — point doesn't move
  expect(eps.end).toEqual({ kind: 'attached', elementId: 'target', siteIndex: 0 });
});

it('connector with both endpoints attached is not in the output map', () => {
  const snapshots: ElementSnapshot[] = [
    {
      kind: 'connector',
      id: 'c',
      worldFrame: { x: 0, y: 0, w: 100, h: 50, rotation: 0 },
      start: { kind: 'attached', elementId: 'a', siteIndex: 0 },
      end:   { kind: 'attached', elementId: 'b', siteIndex: 2 },
    },
  ];
  const result = resizeMultiFrames(
    { scope: [], startBbox: { x: 0, y: 0, w: 100, h: 50, rotation: 0 }, snapshots },
    'se', 50, 25, false,
  );
  expect(result.connectorEndpoints.has('c')).toBe(false);
  // The follower's frame is still computed (used by snap/hit), but writing
  // it back is a no-op in the editor wiring (caller skips fully-attached
  // connectors when batching `updateElementFrame`).
});

it('per-child min-size clamp does not collapse the bbox', () => {
  const snapshots = [
    frameSnap('big',  0,   0, 100, 50),
    frameSnap('tiny', 200, 0, 2,   2),  // 2px child near min
  ];
  const startBbox = { x: 0, y: 0, w: 202, h: 50, rotation: 0 };
  const result = resizeMultiFrames(
    { scope: [], startBbox, snapshots },
    'se', -100, 0, false, // shrink x by ~50%
  );
  // tiny ends up clamped at MIN_SIZE = 1 in x; big shrinks normally.
  expect(result.frames.get('tiny')!.w).toBeGreaterThanOrEqual(1);
  expect(result.frames.get('big')!.w).toBeCloseTo(50, 5);
});
```

Run after each addition: `pnpm --filter @wafflebase/slides test -- interactions/resize.test.ts`
Expected: PASS each time.

- [x] **Step 7: Commit**

```bash
git add packages/slides/src/view/editor/interactions/resize.ts \
        packages/slides/test/view/editor/interactions/resize.test.ts
git commit -m "$(cat <<'EOF'
Add resizeMultiFrames pure helper

Computes the new bbox via the existing resizeFrame and redistributes
per-child world frames via a single affine map (centre and w/h scale
in their local axes relative to the bbox anchor). Connector endpoints
are mapped per-endpoint: free endpoints follow the scale; attached
endpoints stay put. Fully-attached connectors are omitted from the
output map so the editor wiring can skip their endpoint writes.

Covered by unit tests: corner + Shift, edge, rotated child, connector
mixed endpoints, both-attached, per-child min-size clamp.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire `resizeMultiFrames` into `startResize`

Remove the `length !== 1` guard. Add a `length > 1` branch that builds `MultiResizeStart`, runs `resizeMultiFrames` per `pointermove`, redistributes against the snapped bbox, paints via `paintGhostPreview`, and commits in one `store.batch`.

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts` — `startResize` body (lines 5291-5374)

- [x] **Step 1: Add the multi branch (do not yet remove the guard)**

In `editor.ts`, just before the existing `if (selectedIds.length !== 1) return; // multi-resize is a v2 polish item` line, insert:

```ts
    if (selectedIds.length > 1) {
      this.startMultiResize(handle, clientX, clientY, startSlide, scope, selectedIds);
      return;
    }
```

This routes multi to a dedicated helper before the legacy guard.

- [x] **Step 2: Implement `startMultiResize` as a new private method**

After `startResize` ends (just before the class closing brace), add:

```ts
  private startMultiResize(
    handle: ResizeHandle,
    clientX: number,
    clientY: number,
    startSlide: Slide,
    scope: readonly string[],
    selectedIds: readonly string[],
  ): void {
    // Build immutable snapshots in world space. Group `worldFrame`
    // uses worldTightFrame so the bbox matches the overlay handles.
    const snapshots: ElementSnapshot[] = [];
    for (const id of selectedIds) {
      const el = findElement(startSlide.elements, id);
      if (!el) continue;
      const displayLocal =
        el.type === 'group' ? worldTightFrame(el).worldFrame : el.frame;
      const worldFrame = toWorldFrame(displayLocal, scope, startSlide);
      if (el.type === 'connector') {
        snapshots.push({
          kind: 'connector',
          id,
          worldFrame,
          start: el.start,
          end:   el.end,
        });
      } else {
        snapshots.push({ kind: 'frame', id, worldFrame });
      }
    }
    if (snapshots.length < 2) return;
    const startBbox = combinedBoundingBox(snapshots.map((s) => s.worldFrame));
    if (!startBbox) return;

    const start = this.clientToLogical(clientX, clientY);
    const selectedSet = new Set(selectedIds);
    const otherFrames = collectSnapCandidates(startSlide, [...scope], selectedSet);
    const live = {
      result: {
        newBbox: startBbox,
        frames: new Map<string, Frame>(),
        connectorEndpoints: new Map<string, { start: Endpoint; end: Endpoint }>(),
      },
    };

    const onMove = (ev: MouseEvent): void => {
      const cur = this.clientToLogical(ev.clientX, ev.clientY);
      const dx = cur.x - start.x;
      const dy = cur.y - start.y;
      const raw = resizeMultiFrames(
        { scope, startBbox, snapshots },
        handle,
        dx,
        dy,
        ev.shiftKey,
      );
      // Snap the bbox only (matchSize on the children directly would
      // fight with the bbox-anchored child-redistribution math). If
      // matchSize moves the bbox, re-run resizeMultiFrames with
      // adjusted deltas so children stay rigorously tied to the bbox.
      let result = raw;
      if (!ev.shiftKey) {
        const matched = matchSize(
          { x: raw.newBbox.x, y: raw.newBbox.y, w: raw.newBbox.w, h: raw.newBbox.h },
          handle,
          otherFrames,
        );
        if (
          matched.w !== raw.newBbox.w ||
          matched.h !== raw.newBbox.h ||
          matched.x !== raw.newBbox.x ||
          matched.y !== raw.newBbox.y
        ) {
          // Translate the matched bbox back to the dx/dy that produced it.
          const matchedDx =
            handle.includes('e') ? matched.w - startBbox.w
            : handle.includes('w') ? startBbox.x - matched.x
            : 0;
          const matchedDy =
            handle.includes('s') ? matched.h - startBbox.h
            : handle.includes('n') ? startBbox.y - matched.y
            : 0;
          result = resizeMultiFrames(
            { scope, startBbox, snapshots },
            handle,
            matchedDx,
            matchedDy,
            false,
          );
        }
        live.result = { ...result, frames: result.frames, connectorEndpoints: result.connectorEndpoints };
        this.paintMultiResizeLive(snapshots, result, scope, startSlide, matched.guides);
        return;
      }
      live.result = result;
      this.paintMultiResizeLive(snapshots, result, scope, startSlide, []);
    };
    const onUp = (): void => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      const { frames, connectorEndpoints } = live.result;
      this.options.store.batch(() => {
        for (const snap of snapshots) {
          const wf = frames.get(snap.id);
          if (!wf) continue;
          // Fully-attached connectors are not in `connectorEndpoints`;
          // their stored frame is auto-recomputed by the store from
          // their endpoints, so we skip writing them too.
          if (snap.kind === 'connector' && !connectorEndpoints.has(snap.id)) continue;
          this.options.store.updateElementFrame(
            startSlide.id,
            snap.id,
            fromWorldFrame(wf, scope, startSlide),
          );
        }
        for (const [id, eps] of connectorEndpoints) {
          this.options.store.updateConnectorEndpoint(startSlide.id, id, 'start', eps.start);
          this.options.store.updateConnectorEndpoint(startSlide.id, id, 'end',   eps.end);
        }
      });
      this.renderer.markDirty();
      this.render();
      this.repaintOverlay();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  private paintMultiResizeLive(
    snapshots: readonly ElementSnapshot[],
    result: MultiResizeResult,
    scope: readonly string[],
    startSlide: Slide,
    guides: readonly (SnapGuide | SmartGuide)[],
  ): void {
    // Build ghost Elements: each selected element with its frame
    // replaced by the new world frame (and, for connectors, its
    // endpoints replaced by the new endpoints).
    const ghosts: Element[] = [];
    for (const snap of snapshots) {
      const wf = result.frames.get(snap.id);
      if (!wf) continue;
      const el = findElement(startSlide.elements, snap.id);
      if (!el) continue;
      if (el.type === 'connector') {
        const eps = result.connectorEndpoints.get(snap.id);
        ghosts.push({
          ...el,
          frame: wf,
          start: eps ? eps.start : el.start,
          end:   eps ? eps.end   : el.end,
        } as Element);
      } else {
        ghosts.push({ ...el, frame: wf } as Element);
      }
    }
    this.paintGhostPreview(ghosts, ghosts, guides);
  }
```

Imports needed at the top of `editor.ts` (add if missing):

```ts
import {
  resizeFrameWorld,
  resizeMultiFrames,
  type ElementSnapshot,
  type MultiResizeResult,
  type ResizeHandle,
} from './interactions/resize';
import { combinedBoundingBox } from './frame-space';
import { worldTightFrame } from '../../model/group';
```

(Some of these are already imported — only add what's missing. Check `rg -n "^import" packages/slides/src/view/editor/editor.ts | head -30` first.)

- [x] **Step 3: Remove the legacy guard**

In `startResize`, delete the line:

```ts
    if (selectedIds.length !== 1) return; // multi-resize is a v2 polish item
```

The new `if (selectedIds.length > 1)` branch above already handles `> 1`; `length === 0` was unreachable (no handle is rendered then), and `length === 1` falls through to the existing path.

- [x] **Step 4: Flip the characterization test from Task 1**

The Task 1 baseline asserted `after === before`. Update it so it now asserts both elements moved:

```ts
it('multi-select SE-handle drag scales each child by the bbox ratio', async () => {
  const { editor, slide, store } = createEditorWithElements([
    makeRect('a', { x: 0,   y: 0,   w: 100, h: 50 }),
    makeRect('b', { x: 200, y: 100, w: 80,  h: 60 }),
  ]);
  editor.selection.set(['a', 'b']);
  editor.render();

  await dragHandle(editor, 'se', { dx: 280, dy: 160 }); // double the bbox in both axes

  const after = store.read().slides[0].elements;
  // sx = sy = 2: 'a' doubles in size; 'b' doubles and its center moves to (480, 260).
  expect(after.find((e) => e.id === 'a')!.frame).toMatchObject({ x: 0, y: 0, w: 200, h: 100 });
  expect(after.find((e) => e.id === 'b')!.frame).toMatchObject({ x: 400, y: 200, w: 160, h: 120 });
});
```

- [x] **Step 5: Run all tests**

Run: `pnpm --filter @wafflebase/slides test`
Expected: PASS. If the test that called `editor.selection.set(['a', 'b'])` previously asserted the no-op behavior anywhere else, those must be updated too. Search: `rg -n "selection.set(\[" packages/slides/test/view/editor/editor.test.ts`.

- [x] **Step 6: Run lint**

Run: `pnpm verify:fast`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add packages/slides/src/view/editor/editor.ts \
        packages/slides/test/view/editor/editor.test.ts
git commit -m "$(cat <<'EOF'
Wire multi-select resize via resizeMultiFrames

startResize now routes `> 1` selections to a new startMultiResize
helper: world snapshots → resizeMultiFrames per pointermove → bbox
snap via matchSize → ghost preview via paintGhostPreview → one
batched commit on pointerup. Connector free endpoints follow the
bbox; attached endpoints stay attached; fully-attached connectors
are skipped on commit (their frame auto-resolves from their target
shapes).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Multi-resize integration tests for non-trivial selections

Cover the cases that the unit tests in Task 4 cannot: group + shape, table + shape, connector with attached endpoint, drilled-in scope, single batched undo.

**Files:**
- Create: `packages/slides/test/view/editor/interactions/multi-resize.test.ts`

- [x] **Step 1: Create the test file**

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import {
  createEditorWithElements,
  makeRect,
  makeGroup,
  makeTable,
  makeConnector,
  dragHandle,
} from '../helpers';
// If these helpers do not exist, mirror the construction from existing
// editor.test.ts cases. Build a real editor + store, not mocks.

describe('multi-select resize integration', () => {
  it('group child scales as a frame; inner refSize is unchanged', async () => {
    const { editor, store } = createEditorWithElements([
      makeRect('a', { x: 0, y: 0, w: 100, h: 50 }),
      makeGroup('g', { x: 200, y: 100, w: 100, h: 100 }, [
        makeRect('g.child', { x: 10, y: 10, w: 80, h: 80 }),
      ]),
    ]);
    editor.selection.set(['a', 'g']);
    editor.render();
    const groupBefore = store.read().slides[0].elements.find((e) => e.id === 'g')!;
    const refSizeBefore = (groupBefore as any).data.refSize;

    await dragHandle(editor, 'se', { dx: 100, dy: 50 }); // bbox grows; sx, sy ratio depends on layout

    const groupAfter = store.read().slides[0].elements.find((e) => e.id === 'g')!;
    expect((groupAfter as any).data.refSize).toEqual(refSizeBefore); // refSize untouched
    expect(groupAfter.frame.w).toBeGreaterThan(groupBefore.frame.w);
  });

  it('connector with one attached endpoint: free endpoint scales, attached endpoint persists', async () => {
    const { editor, store } = createEditorWithElements([
      makeRect('target', { x: 200, y: 100, w: 80, h: 60 }),
      makeConnector('c', {
        start: { kind: 'free', x: 0, y: 0 },
        end:   { kind: 'attached', elementId: 'target', siteIndex: 0 },
      }),
    ]);
    editor.selection.set(['target', 'c']);
    editor.render();
    await dragHandle(editor, 'se', { dx: 100, dy: 50 });
    const connector = store.read().slides[0].elements.find((e) => e.id === 'c')! as any;
    expect(connector.end.kind).toBe('attached'); // attached endpoint preserved
    expect(connector.end.elementId).toBe('target');
  });

  it('one batched undo reverts the whole gesture', async () => {
    const { editor, store } = createEditorWithElements([
      makeRect('a', { x: 0,   y: 0,   w: 100, h: 50 }),
      makeRect('b', { x: 200, y: 100, w: 80,  h: 60 }),
    ]);
    editor.selection.set(['a', 'b']);
    editor.render();
    const before = JSON.stringify(store.read().slides[0].elements);
    await dragHandle(editor, 'se', { dx: 100, dy: 50 });
    expect(JSON.stringify(store.read().slides[0].elements)).not.toEqual(before);
    store.undo();
    expect(JSON.stringify(store.read().slides[0].elements)).toEqual(before);
  });

  it('drilled-in scope: resize 2 children inside a group', async () => {
    const { editor, store } = createEditorWithElements([
      makeGroup('g', { x: 0, y: 0, w: 300, h: 200 }, [
        makeRect('g.a', { x: 0,   y: 0,   w: 100, h: 50 }),
        makeRect('g.b', { x: 150, y: 0,   w: 100, h: 50 }),
      ]),
    ]);
    editor.selection.setScope(['g']);
    editor.selection.set(['g.a', 'g.b']);
    editor.render();
    await dragHandle(editor, 'e', { dx: 50, dy: 0 });
    const groupAfter = store.read().slides[0].elements.find((e) => e.id === 'g')! as any;
    const ga = groupAfter.data.children.find((c: any) => c.id === 'g.a');
    const gb = groupAfter.data.children.find((c: any) => c.id === 'g.b');
    expect(ga.frame.w).toBeGreaterThan(100);
    expect(gb.frame.w).toBeGreaterThan(100);
  });
});
```

For helpers that don't exist, either inline the construction (look at adjacent tests for the pattern) or add minimal ones to the test directory's shared `helpers.ts`. Inline is preferred per the "no premature abstraction" rule in CLAUDE.md.

- [x] **Step 2: Run tests**

Run: `pnpm --filter @wafflebase/slides test -- interactions/multi-resize.test.ts`
Expected: PASS.

- [x] **Step 3: Commit**

```bash
git add packages/slides/test/view/editor/interactions/multi-resize.test.ts
git commit -m "$(cat <<'EOF'
Add multi-resize integration tests for non-trivial selections

Covers: group's refSize untouched on multi-resize, connector with
attached endpoint preserves its attachment, single batched undo
reverts the whole gesture, drilled-in scope works inside a group.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Visual harness scenarios

Add fixtures so reviewers can see the new behaviour and so the visual-regression lane catches future paint changes.

**Files:**
- Modify: `packages/frontend/src/app/harness/visual/slides-scenarios.tsx`

- [x] **Step 1: Read existing scenarios to learn the seeding + pointer-simulation pattern**

Run: `rg -n "scenarios.push|simulateDrag|pointerdown|setup:" packages/frontend/src/app/harness/visual/slides-scenarios.tsx | head -40`
Expected: A list of existing scenarios. Pick the closest matches:

- For seeding two shapes + selecting them + driving a handle drag: look for an existing scenario whose drag involves selection-handle math (e.g. any current resize / rotate scenario). Note the helpers it calls (selection.set, the function it uses to dispatch synthetic pointer events).
- For "mid-drag" capture: look for any scenario that dispatches `pointerdown` + `pointermove` without `pointerup`. If none exists, the new scenarios will be the first; reuse the synthetic-pointer dispatcher from the existing drag scenarios but omit the `pointerup` dispatch.

Record the exact helper names you find — they are project-specific and replace the named callouts below.

- [x] **Step 2: Add four new scenarios at the end of the file**

Use the helpers identified in Step 1. The bodies below use placeholder helper names (`seedRect`, `simulateHandleDrag`, etc.); replace them with the actual project helpers from Step 1 before saving.

```tsx
scenarios.push({
  id: 'slides-multi-resize-basic',
  label: 'Slides: multi-select resize (2 rects, SE drag)',
  setup: (editor) => {
    const a = seedRect(editor, { x: 0,   y: 0,   w: 100, h: 50 });
    const b = seedRect(editor, { x: 200, y: 100, w: 80,  h: 60 });
    editor.selection.set([a, b]);
    editor.render();
    simulateHandleDrag(editor, 'se', { dx: 100, dy: 50 });
  },
});

scenarios.push({
  id: 'slides-multi-resize-with-rotated-child',
  label: 'Slides: multi-select resize with one rotated child',
  setup: (editor) => {
    const a = seedRect(editor, { x: 0,   y: 0,   w: 100, h: 50 });
    const b = seedRect(editor, { x: 200, y: 100, w: 100, h: 50, rotation: Math.PI / 6 });
    editor.selection.set([a, b]);
    editor.render();
    simulateHandleDrag(editor, 'se', { dx: 100, dy: 50 });
  },
});

scenarios.push({
  id: 'slides-resize-ghost-mid-drag',
  label: 'Slides: single non-table resize ghost mid-drag',
  setup: (editor) => {
    const a = seedRect(editor, { x: 50, y: 50, w: 200, h: 100 });
    editor.selection.set([a]);
    editor.render();
    simulateHandleDragMidGesture(editor, 'se', { dx: 80, dy: 40 });
  },
});

scenarios.push({
  id: 'slides-multi-resize-ghost-mid-drag',
  label: 'Slides: multi-select resize ghost mid-drag',
  setup: (editor) => {
    const a = seedRect(editor, { x: 0,   y: 0,   w: 100, h: 50 });
    const b = seedRect(editor, { x: 200, y: 100, w: 80,  h: 60 });
    editor.selection.set([a, b]);
    editor.render();
    simulateHandleDragMidGesture(editor, 'se', { dx: 80, dy: 40 });
  },
});
```

`simulateHandleDrag` runs `pointerdown` + `pointermove` + `pointerup`; `simulateHandleDragMidGesture` runs `pointerdown` + `pointermove` but **omits** the `pointerup` so the screenshot captures the live ghost state. Both must use the project's existing synthetic-pointer dispatcher (found in Step 1).

- [x] **Step 3: Run the visual harness**

Run: `pnpm verify:browser:docker` (or, locally, `pnpm dev` and open the harness UI to confirm the scenarios render).
Expected: New scenarios render; the resize ghost shows the original at full opacity and the ghost translucent.

- [x] **Step 4: Commit**

```bash
git add packages/frontend/src/app/harness/visual/slides-scenarios.tsx
git commit -m "$(cat <<'EOF'
Add visual scenarios for multi-resize and resize ghost mid-drag

slides-multi-resize-basic, slides-multi-resize-with-rotated-child,
slides-resize-ghost-mid-drag, slides-multi-resize-ghost-mid-drag.
The mid-drag scenarios capture the original+ghost composite that the
new paintGhostPreview path produces for single and multi resize.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Optional cleanup — extract `rotateMultiFrames` for symmetry

`startRotate`'s `buildLiveState` already handles multi via the `isMulti` branch. This task extracts that math into a pure helper so the editor stays a thin orchestrator. **Skip if you are time-constrained; the runtime behavior is unchanged.**

**Files:**
- Modify: `packages/slides/src/view/editor/interactions/rotate.ts` (append)
- Modify: `packages/slides/src/view/editor/editor.ts` (`startRotate`'s `buildLiveState`)
- Test: `packages/slides/test/view/editor/interactions/rotate.test.ts`

- [x] **Step 1: Add the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { rotateMultiFrames } from '../../../../src/view/editor/interactions/rotate';

describe('rotateMultiFrames', () => {
  it('rotates each child centre around the pivot and adds delta to rotation', () => {
    const startBbox = { x: 0, y: 0, w: 200, h: 100, rotation: 0 };
    const snapshots = [
      { kind: 'frame' as const, id: 'a', worldFrame: { x: 0,   y: 0, w: 50, h: 50, rotation: 0 } },
      { kind: 'frame' as const, id: 'b', worldFrame: { x: 150, y: 0, w: 50, h: 50, rotation: 0 } },
    ];
    const { frames } = rotateMultiFrames(
      { scope: [], startBbox, snapshots },
      0,             // startAngle
      Math.PI / 2,   // 90°
      false,
    );
    // Pivot = (100, 50). 90° rotation around pivot:
    // 'a' centre (25, 25) → pivot + R(90°)(25-100, 25-50) = pivot + (25, -75) = (125, -25). frame center → (125, -25); w=h=50; rotation=π/2.
    expect(frames.get('a')!.rotation).toBeCloseTo(Math.PI / 2);
    expect(frames.get('a')!.x).toBeCloseTo(100); // 125 - w/2
    expect(frames.get('a')!.y).toBeCloseTo(-50); // -25 - h/2
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test -- interactions/rotate.test.ts`
Expected: FAIL — `rotateMultiFrames` is not exported.

- [x] **Step 3: Implement in `interactions/rotate.ts`**

Append:

```ts
import type { Frame } from '../../../model/element';
import type { Endpoint } from '../../../model/connector';
import type { ElementSnapshot, MultiResizeStart } from './resize';

export interface MultiRotateResult {
  frames: Map<string, Frame>;
  connectorEndpoints: Map<string, { start: Endpoint; end: Endpoint }>;
}

export function rotateMultiFrames(
  start: MultiResizeStart,
  startAngle: number,
  currentAngle: number,
  shift: boolean,
): MultiRotateResult {
  const raw = currentAngle - startAngle;
  const dθ = shift ? snapAngle(raw) : raw;
  const px = start.startBbox.x + start.startBbox.w / 2;
  const py = start.startBbox.y + start.startBbox.h / 2;
  const cos = Math.cos(dθ);
  const sin = Math.sin(dθ);

  const rotateAround = (x: number, y: number) => ({
    x: px + (x - px) * cos - (y - py) * sin,
    y: py + (x - px) * sin + (y - py) * cos,
  });

  const frames = new Map<string, Frame>();
  const connectorEndpoints = new Map<string, { start: Endpoint; end: Endpoint }>();

  for (const snap of start.snapshots) {
    const cx = snap.worldFrame.x + snap.worldFrame.w / 2;
    const cy = snap.worldFrame.y + snap.worldFrame.h / 2;
    const c2 = rotateAround(cx, cy);
    frames.set(snap.id, {
      x: c2.x - snap.worldFrame.w / 2,
      y: c2.y - snap.worldFrame.h / 2,
      w: snap.worldFrame.w,
      h: snap.worldFrame.h,
      rotation: (snap.worldFrame.rotation + dθ) % (2 * Math.PI),
    });

    if (snap.kind === 'connector') {
      const rotateEp = (ep: Endpoint): Endpoint => {
        if (ep.kind === 'attached') return ep;
        const p = rotateAround(ep.x, ep.y);
        return { kind: 'free', x: p.x, y: p.y };
      };
      if (snap.start.kind === 'free' || snap.end.kind === 'free') {
        connectorEndpoints.set(snap.id, {
          start: rotateEp(snap.start),
          end:   rotateEp(snap.end),
        });
      }
    }
  }

  return { frames, connectorEndpoints };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/slides test -- interactions/rotate.test.ts`
Expected: PASS.

- [x] **Step 5: Wire the helper into `startRotate`**

In `editor.ts`'s `startRotate`, the `buildLiveState` closure can stay (it also computes `liveFrames` for `connectorEndpoint` writes via the local rotation). Wiring is optional — call `rotateMultiFrames` for assertions only if useful. Skip the editor change unless a future refactor warrants it; the helper is now available for new call sites.

- [x] **Step 6: Commit**

```bash
git add packages/slides/src/view/editor/interactions/rotate.ts \
        packages/slides/test/view/editor/interactions/rotate.test.ts
git commit -m "$(cat <<'EOF'
Extract rotateMultiFrames pure helper for symmetry with resize

The math already lives inline in startRotate's buildLiveState; this
helper exposes it for direct unit tests and gives future call sites
a typed entry point. Runtime behavior of startRotate is unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Run the full verification gate

**Files:** none

- [x] **Step 1: Run the fast verification lane**

Run: `pnpm verify:fast`
Expected: PASS. If lint flags new lines, fix in place; if a unit test fails, debug from the error not by relaxing the test.

- [x] **Step 2: Run the self-check lane (builds all packages)**

Run: `pnpm verify:self`
Expected: PASS. This catches any cross-package TypeScript breakage from the rename / new types.

- [x] **Step 3: Manual smoke**

Run: `pnpm dev`
Manually:
1. Single shape — drag SE handle. Original stays full opacity, ghost previews, commit on release.
2. Multi (2 rects) — drag SE handle. Both scale by the bbox ratio.
3. Multi (2 rects) — drag NW handle. Both scale toward the SE anchor.
4. Multi (2 rects, Shift) — drag SE handle. Uniform scale.
5. Multi (rect + rotated rect) — drag SE handle. Rotated rect's `w/h` scale; rotation preserved.
6. Multi (rect + group) — drag SE handle. Group's children stay proportional (refSize unchanged).
7. Multi (rect + connector with attached endpoint to a third rect) — drag SE handle. Connector's free endpoint moves; attached endpoint stays put.
8. Multi rotate — drag rotate handle 45°. All children rotate rigidly around bbox centre.

- [x] **Step 4: Capture lessons + archive**

If you discovered any nuance not captured in the spec (e.g. a rotated-child case that surprised you), write it to `docs/tasks/active/20260612-multi-select-resize-lessons.md`. Otherwise create an empty lessons file with a one-line note.

```bash
echo "# Multi-Select Resize Lessons" > docs/tasks/active/20260612-multi-select-resize-lessons.md
echo "" >> docs/tasks/active/20260612-multi-select-resize-lessons.md
echo "No surprises beyond what the spec already documented." >> docs/tasks/active/20260612-multi-select-resize-lessons.md
```

Then archive:

```bash
pnpm tasks:archive && pnpm tasks:index
```

- [x] **Step 5: Final commit**

```bash
git add docs/tasks/
git commit -m "$(cat <<'EOF'
Archive multi-select resize task

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
