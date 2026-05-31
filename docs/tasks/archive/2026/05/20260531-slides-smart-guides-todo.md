# Slides Smart Guides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PowerPoint / Google Slides-style smart guides to the slides editor — equal-spacing trios + equal-distance pairs that fire during element drag, plus equal-size matching during resize — with red double-headed arrow / dashed-outline overlays.

**Architecture:** One new pure-function module (`view/editor/smart-guides.ts`) exporting `smartGuides()` (drag refinement after `snapDelta`) and `matchSize()` (resize refinement). Both reuse `collectSnapCandidates` results from the existing pipeline. Overlay rendering adds two HTML/CSS primitives (`makeSmartGuideArrow`, `makeSmartGuideOutline`) to `overlay.ts` next to the existing `makeGuide`.

**Tech Stack:** TypeScript, Vitest, `@wafflebase/slides`.

Design doc: [docs/design/slides/slides-smart-guides.md](../../design/slides/slides-smart-guides.md).

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `packages/slides/src/view/editor/smart-guides.ts` | Pure detection (`smartGuides`, `matchSize`) and `SmartGuide` type | Create |
| `packages/slides/test/view/editor/smart-guides.test.ts` | Unit tests for all detection logic | Create |
| `packages/slides/src/view/editor/overlay.ts` | Render `SmartGuide` via new `makeSmartGuideArrow` / `makeSmartGuideOutline` (extend `OverlayOptions.guides` to accept the union) | Modify |
| `packages/slides/src/view/editor/editor.ts` | Wire `smartGuides` into move-drag (after `snapDelta`), `matchSize` into `startResize`, pass merged guides into `paintMoveGhost`/`paintLiveScoped` | Modify |
| `packages/slides/test/view/editor/snap.test.ts` | Sanity test that `snapDelta` still returns identical results when smart-guides runs after it (no regression) | (no change expected; verify pass) |
| `docs/design/slides/slides-smart-guides.md` | Already written; mark target-version 0.5.0 | (no change in this branch) |

**Conventions discovered:**

- Tests at `packages/slides/test/view/editor/*.test.ts` mirror `src/view/editor/*.ts`. Vitest `describe`/`it`/`expect`. See `snap.test.ts` (the closest stylistic neighbour): it uses a tiny `f(x, y, w, h)` Frame factory, hardcodes `SLIDE = { w: 1920, h: 1080 }`, and asserts numeric adjustments directly.
- `Frame` type lives at `packages/slides/src/model/element.ts`. `Frame = { x, y, w, h, rotation }`. Helper: `boundingBox(frame)` returns the rotated AABB (used by `snap-candidates.ts`).
- The drag handler that already calls `snapDelta` is in `editor.ts:2450-2473` (inside the `onMove` closure created by the move-drag bootstrap at ~`editor.ts:2410`). `snapDelta` returns `{ dx, dy, guides }`; that `guides` array currently flows straight into `paintMoveGhost(ghosts, handleElements, guides)` at line 2530.
- The resize handler is `startResize` at `editor.ts:3265`. Its `onMove` is at 3293-3300; it computes `live.worldFrame = resizeFrameWorld(startWorldFrame, handle, dx, dy, ev.shiftKey)` and then `paintLiveScoped(livMap, scope)` — **without** any snap pass today. We will add `matchSize` between those two lines.
- `paintLiveScoped(worldFrames, scope, guides?)` at `editor.ts:2593` already accepts an optional `guides` parameter (currently only the move-drag path uses it). Resize can pass its own guides through the same param after we extend it.
- `renderOverlay` in `overlay.ts` clears `innerHTML` on every call, so guides disappear naturally when the drag handler stops including them. No fade animation needed.
- `OverlayOptions.guides` is `readonly SnapGuide[]` today (`overlay.ts:34`). Widen to `readonly (SnapGuide | SmartGuide)[]` (single union; same array, dispatched on `kind`).
- Existing guide colour: `#e11d48` (`overlay.ts:479`). Reuse for smart-guide arrows + dashed outlines so the visual vocabulary stays one colour.
- No ANTLR codegen touched.

---

## Task 1: `smart-guides` module skeleton + types

**Files:**
- Create: `packages/slides/src/view/editor/smart-guides.ts`
- Create: `packages/slides/test/view/editor/smart-guides.test.ts`

- [x] **Step 1: Write failing skeleton test**

Create `packages/slides/test/view/editor/smart-guides.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { Frame } from '../../../src/model/element';
import { smartGuides } from '../../../src/view/editor/smart-guides';

const f = (x: number, y: number, w: number, h: number): Frame => ({
  x, y, w, h, rotation: 0,
});

describe('smartGuides (skeleton)', () => {
  it('returns the dx/dy unchanged and an empty guide list when others is empty', () => {
    const bbox = { x: 100, y: 100, w: 50, h: 50 };
    const out = smartGuides(bbox, 7, 11, []);
    expect(out.dx).toBe(7);
    expect(out.dy).toBe(11);
    expect(out.guides).toEqual([]);
  });
});
```

- [x] **Step 2: Run to confirm it fails**

Run: `pnpm --filter @wafflebase/slides test smart-guides.test`
Expected: FAIL — `Cannot find module '.../smart-guides'`.

- [x] **Step 3: Create the module skeleton**

Create `packages/slides/src/view/editor/smart-guides.ts`:

```typescript
import type { Frame } from '../../model/element';

/**
 * One side of an arrow span used by the smart-guide overlay. `from` /
 * `to` are world coords on the matched axis; `perpendicular` is the
 * fixed coordinate on the other axis (the row/column the arrow is
 * drawn at).
 */
export type Span = { from: number; to: number; perpendicular: number };

/**
 * Result of detecting an equal-spacing trio, an equal-distance pair,
 * or an equal-size match. Rendered by `overlay.ts` alongside the
 * existing edge / center / user-guide `SnapGuide` set.
 *
 *  - equal-spacing  → two same-axis arrows at the middle element's
 *                     centre, one for each gap.
 *  - equal-distance → two same-axis arrows — the existing pair's gap
 *                     and the new (drag, neighbour) gap.
 *  - equal-size     → a dashed outline around every matched frame.
 */
export type SmartGuide =
  | { kind: 'equal-spacing';  axis: 'x' | 'y'; spans: [Span, Span] }
  | { kind: 'equal-distance'; axis: 'x' | 'y'; spans: [Span, Span] }
  | { kind: 'equal-size';     axis: 'x' | 'y'; matchedFrames: Frame[] };

/**
 * Refine the snap-corrected (`dx`, `dy`) further when the dragged
 * bbox would form an equal-spacing trio or equal-distance pair with
 * `others`. Called AFTER `snapDelta`: any edge/centre/guide snap has
 * already won. Threshold is the same 8 px band the rest of the editor
 * uses.
 *
 * Axes are independent — `x` may match equal-spacing while `y` is
 * untouched.
 *
 * Skeleton implementation returns the input unchanged; subsequent
 * tasks add equal-spacing and equal-distance detection.
 */
export function smartGuides(
  bbox: { x: number; y: number; w: number; h: number },
  dx: number,
  dy: number,
  others: readonly Frame[],
): { dx: number; dy: number; guides: SmartGuide[] } {
  // Reference `bbox` and `others` so TypeScript does not flag them as
  // unused; the next tasks fill in the body.
  void bbox;
  void others;
  return { dx, dy, guides: [] };
}
```

- [x] **Step 4: Run to confirm green**

Run: `pnpm --filter @wafflebase/slides test smart-guides.test`
Expected: PASS (1 test).

- [x] **Step 5: Commit**

```bash
git add packages/slides/src/view/editor/smart-guides.ts \
        packages/slides/test/view/editor/smart-guides.test.ts
git commit -m "$(cat <<'EOF'
Add slides smart-guides module skeleton

First step toward PowerPoint-style equal-spacing / equal-distance /
equal-size guides during shape drag and resize. This commit lands
just the SmartGuide type and an identity-return smartGuides() so the
later tasks can layer detection on top one pattern at a time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Equal-spacing detection (dragged in the middle)

**Files:**
- Modify: `packages/slides/src/view/editor/smart-guides.ts`
- Modify: `packages/slides/test/view/editor/smart-guides.test.ts`

- [x] **Step 1: Add failing tests for middle-trio equal-spacing**

Append to `smart-guides.test.ts`:

```typescript
describe('smartGuides — equal-spacing (dragged in middle)', () => {
  // A and B at y=100, both 100x100. Dragged at y=100, also 100x100.
  // A: x=0..100. B: x=600..700. Centre-equal spacing puts dragged at
  // x=300..400 (gaps both = 200). If dragged would land at x=298 the
  // adjust is +2 (well inside 8 px). At x=290 it would be +10, outside.
  const A: Frame = { x: 0,   y: 100, w: 100, h: 100, rotation: 0 };
  const B: Frame = { x: 600, y: 100, w: 100, h: 100, rotation: 0 };

  it('snaps the middle bbox so the two gaps are equal', () => {
    // dragged starts at x=200, drag dx=98 -> would land at x=298.
    // Need to verify smartGuides returns dx adjust of +2.
    const bbox = { x: 200, y: 100, w: 100, h: 100 };
    const out = smartGuides(bbox, 98, 0, [A, B]);
    expect(out.dx).toBe(100); // 98 + 2.
    expect(out.dy).toBe(0);
    expect(out.guides).toHaveLength(1);
    const g = out.guides[0];
    expect(g.kind).toBe('equal-spacing');
    expect(g.axis).toBe('x');
  });

  it('does NOT snap when both gaps differ by more than the threshold band', () => {
    // dragged would land at x=200 — gapL = 100, gapR = 400; need +150
    // to balance. Far outside the 8 px band.
    const bbox = { x: 100, y: 100, w: 100, h: 100 };
    const out = smartGuides(bbox, 0, 0, [A, B]);
    expect(out.dx).toBe(0);
    expect(out.guides).toEqual([]);
  });

  it('ignores trios whose rows do not overlap (perpendicular-axis miss)', () => {
    // Move B far down so y-overlap with dragged (y=100..200) is zero.
    const Bfar: Frame = { x: 600, y: 800, w: 100, h: 100, rotation: 0 };
    const bbox = { x: 200, y: 100, w: 100, h: 100 };
    const out = smartGuides(bbox, 98, 0, [A, Bfar]);
    expect(out.dx).toBe(98);
    expect(out.guides).toEqual([]);
  });

  it('works on the y-axis with vertically-stacked neighbours', () => {
    const top: Frame = { x: 100, y: 0,   w: 100, h: 100, rotation: 0 };
    const bot: Frame = { x: 100, y: 600, w: 100, h: 100, rotation: 0 };
    // dragged at y=200 dragging down by dy=98 -> y=298. Even gaps at y=300.
    const bbox = { x: 100, y: 200, w: 100, h: 100 };
    const out = smartGuides(bbox, 0, 98, [top, bot]);
    expect(out.dy).toBe(100);
    expect(out.guides).toHaveLength(1);
    expect(out.guides[0].kind).toBe('equal-spacing');
    expect(out.guides[0].axis).toBe('y');
  });

  it('picks the smallest |adjust| when two trios both qualify', () => {
    // Trio 1: A — dragged — B (needs +2 to balance).
    // Trio 2: A — dragged — C (needs +5 to balance).
    // Trio 1 should win.
    const C: Frame = { x: 606, y: 100, w: 100, h: 100, rotation: 0 };
    const bbox = { x: 200, y: 100, w: 100, h: 100 };
    const out = smartGuides(bbox, 98, 0, [A, B, C]);
    expect(out.dx).toBe(100); // wins by +2 over +5.
  });
});
```

- [x] **Step 2: Run to confirm they fail**

Run: `pnpm --filter @wafflebase/slides test smart-guides.test`
Expected: FAIL on the 5 new tests.

- [x] **Step 3: Implement middle-trio detection**

Replace the body of `smartGuides` in `smart-guides.ts`:

```typescript
const THRESHOLD = 8;

type Drag = {
  leftPx: number; rightPx: number; centerXPx: number;
  topPx: number;  bottomPx: number; centerYPx: number;
};

function makeDrag(
  bbox: { x: number; y: number; w: number; h: number },
  dx: number,
  dy: number,
): Drag {
  return {
    leftPx:   bbox.x + dx,
    rightPx:  bbox.x + dx + bbox.w,
    centerXPx: bbox.x + dx + bbox.w / 2,
    topPx:    bbox.y + dy,
    bottomPx: bbox.y + dy + bbox.h,
    centerYPx: bbox.y + dy + bbox.h / 2,
  };
}

function overlapsRow(d: Drag, o: Frame): boolean {
  return d.bottomPx > o.y && d.topPx < o.y + o.h;
}

function overlapsCol(d: Drag, o: Frame): boolean {
  return d.rightPx > o.x && d.leftPx < o.x + o.w;
}

export function smartGuides(
  bbox: { x: number; y: number; w: number; h: number },
  dx: number,
  dy: number,
  others: readonly Frame[],
): { dx: number; dy: number; guides: SmartGuide[] } {
  const d = makeDrag(bbox, dx, dy);

  type Cand = {
    adjust: number;
    guide: SmartGuide;
  };

  let bestX: Cand | null = null;
  let bestY: Cand | null = null;
  const tryX = (c: Cand) => {
    if (Math.abs(c.adjust) > THRESHOLD) return;
    if (!bestX || Math.abs(c.adjust) < Math.abs(bestX.adjust)) bestX = c;
  };
  const tryY = (c: Cand) => {
    if (Math.abs(c.adjust) > THRESHOLD) return;
    if (!bestY || Math.abs(c.adjust) < Math.abs(bestY.adjust)) bestY = c;
  };

  // Equal-spacing — dragged in the middle, A on the left, B on the right.
  // X-axis: A.right ≤ drag.left, B.left ≥ drag.right, same row.
  for (let i = 0; i < others.length; i++) {
    const a = others[i];
    if (!overlapsRow(d, a)) continue;
    for (let j = 0; j < others.length; j++) {
      if (i === j) continue;
      const b = others[j];
      if (!overlapsRow(d, b)) continue;
      if (a.x + a.w > d.leftPx) continue;     // A must be fully left
      if (b.x < d.rightPx) continue;          // B must be fully right
      const gapL = d.leftPx - (a.x + a.w);
      const gapR = b.x - d.rightPx;
      const adjust = (gapR - gapL) / 2;
      tryX({
        adjust,
        guide: {
          kind: 'equal-spacing',
          axis: 'x',
          spans: [
            { from: a.x + a.w, to: d.leftPx + adjust, perpendicular: d.centerYPx },
            { from: d.rightPx + adjust, to: b.x,      perpendicular: d.centerYPx },
          ],
        },
      });
    }
  }
  // Y-axis mirror.
  for (let i = 0; i < others.length; i++) {
    const a = others[i];
    if (!overlapsCol(d, a)) continue;
    for (let j = 0; j < others.length; j++) {
      if (i === j) continue;
      const b = others[j];
      if (!overlapsCol(d, b)) continue;
      if (a.y + a.h > d.topPx) continue;
      if (b.y < d.bottomPx) continue;
      const gapT = d.topPx - (a.y + a.h);
      const gapB = b.y - d.bottomPx;
      const adjust = (gapB - gapT) / 2;
      tryY({
        adjust,
        guide: {
          kind: 'equal-spacing',
          axis: 'y',
          spans: [
            { from: a.y + a.h, to: d.topPx + adjust, perpendicular: d.centerXPx },
            { from: d.bottomPx + adjust, to: b.y,    perpendicular: d.centerXPx },
          ],
        },
      });
    }
  }

  const guides: SmartGuide[] = [];
  if (bestX) guides.push((bestX as Cand).guide);
  if (bestY) guides.push((bestY as Cand).guide);
  return {
    dx: dx + (bestX ? (bestX as Cand).adjust : 0),
    dy: dy + (bestY ? (bestY as Cand).adjust : 0),
    guides,
  };
}
```

- [x] **Step 4: Run to confirm green**

Run: `pnpm --filter @wafflebase/slides test smart-guides.test`
Expected: PASS (skeleton + 5 new tests).

- [x] **Step 5: Commit**

```bash
git add packages/slides/src/view/editor/smart-guides.ts \
        packages/slides/test/view/editor/smart-guides.test.ts
git commit -m "$(cat <<'EOF'
Detect equal-spacing trios in slides smart-guides

When the dragged element sits between two others on the same row or
column, snap the middle gap to balance with the outer one. Same 8 px
band the existing snapDelta uses; per-axis smallest-adjust tie-break
keeps the choice deterministic against multiple qualifying trios.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Equal-spacing detection (dragged at an end)

**Files:**
- Modify: `packages/slides/src/view/editor/smart-guides.ts`
- Modify: `packages/slides/test/view/editor/smart-guides.test.ts`

- [x] **Step 1: Add failing tests for end-trio**

Append to `smart-guides.test.ts`:

```typescript
describe('smartGuides — equal-spacing (dragged on an end)', () => {
  // Same-row pair (A, B) gap = 100. dragged on the right of B.
  const A: Frame = { x: 0,   y: 100, w: 100, h: 100, rotation: 0 };
  const B: Frame = { x: 200, y: 100, w: 100, h: 100, rotation: 0 };

  it('snaps a right-end dragged element to make gap(B, dragged) == gap(A, B)', () => {
    // dragged at x=395 (gap 95). Adjust to +5 to land at x=400 (gap 100).
    const bbox = { x: 395, y: 100, w: 50, h: 50 };
    const out = smartGuides(bbox, 0, 0, [A, B]);
    expect(out.dx).toBe(5);
    expect(out.guides[0].kind).toBe('equal-spacing');
  });

  it('snaps a left-end dragged element to make gap(dragged, A) == gap(A, B)', () => {
    // gap(A,B) = 100. dragged on left at x=-205 (right edge -155, gap 155 to A.left=0... wait).
    // dragged is 50 wide. To leave gap(dragged.right, A.left) = 100, dragged.right = -100,
    // dragged.x = -150. If dragged at x=-148, adjust = -2.
    const bbox = { x: -148, y: 100, w: 50, h: 50 };
    const out = smartGuides(bbox, 0, 0, [A, B]);
    expect(out.dx).toBe(-2);
    expect(out.guides[0].kind).toBe('equal-spacing');
  });

  it('does not consider end-trios when the pair does not share a row with dragged', () => {
    const Afar: Frame = { x: 0,   y: 700, w: 100, h: 100, rotation: 0 };
    const Bfar: Frame = { x: 200, y: 700, w: 100, h: 100, rotation: 0 };
    const bbox = { x: 395, y: 100, w: 50, h: 50 };
    const out = smartGuides(bbox, 0, 0, [Afar, Bfar]);
    expect(out.dx).toBe(0);
    expect(out.guides).toEqual([]);
  });
});
```

- [x] **Step 2: Run to confirm failure**

Run: `pnpm --filter @wafflebase/slides test smart-guides.test`
Expected: FAIL on the 2 positive cases (the perpendicular-miss case already passes).

- [x] **Step 3: Extend `smartGuides` with end-trio detection**

Inside `smartGuides`, immediately after the existing middle-trio X loop, add an end-trio loop:

```typescript
  // Equal-spacing — dragged at an END. Pair (A, B) with A.right < B.left
  // already same-row. Two cases:
  //   1) dragged.left ≥ B.right → make gap(B, dragged) == gap(A, B)
  //   2) dragged.right ≤ A.left → make gap(dragged, A) == gap(A, B)
  for (let i = 0; i < others.length; i++) {
    const a = others[i];
    if (!overlapsRow(d, a)) continue;
    for (let j = 0; j < others.length; j++) {
      if (i === j) continue;
      const b = others[j];
      if (!overlapsRow(d, b)) continue;
      if (a.x + a.w >= b.x) continue;  // need A strictly left of B
      const innerGap = b.x - (a.x + a.w);
      // Case 1: dragged on the right of B.
      if (d.leftPx >= b.x + b.w) {
        const outerGap = d.leftPx - (b.x + b.w);
        const adjust = innerGap - outerGap;
        tryX({
          adjust,
          guide: {
            kind: 'equal-spacing',
            axis: 'x',
            spans: [
              { from: a.x + a.w, to: b.x,            perpendicular: d.centerYPx },
              { from: b.x + b.w, to: d.leftPx + adjust, perpendicular: d.centerYPx },
            ],
          },
        });
      }
      // Case 2: dragged on the left of A.
      if (d.rightPx <= a.x) {
        const outerGap = a.x - d.rightPx;
        const adjust = -(innerGap - outerGap);
        tryX({
          adjust,
          guide: {
            kind: 'equal-spacing',
            axis: 'x',
            spans: [
              { from: d.rightPx + adjust, to: a.x, perpendicular: d.centerYPx },
              { from: a.x + a.w, to: b.x,          perpendicular: d.centerYPx },
            ],
          },
        });
      }
    }
  }
```

(Y-axis end-trio is mirror; skipped here for brevity — add the equivalent loop right after the existing middle-trio Y loop, swapping `overlapsCol`/`top`/`bottom`/`y`/`h` and `perpendicular: d.centerXPx`.)

For completeness, add the Y-axis end-trio loop:

```typescript
  for (let i = 0; i < others.length; i++) {
    const a = others[i];
    if (!overlapsCol(d, a)) continue;
    for (let j = 0; j < others.length; j++) {
      if (i === j) continue;
      const b = others[j];
      if (!overlapsCol(d, b)) continue;
      if (a.y + a.h >= b.y) continue;
      const innerGap = b.y - (a.y + a.h);
      if (d.topPx >= b.y + b.h) {
        const outerGap = d.topPx - (b.y + b.h);
        const adjust = innerGap - outerGap;
        tryY({
          adjust,
          guide: {
            kind: 'equal-spacing',
            axis: 'y',
            spans: [
              { from: a.y + a.h, to: b.y,             perpendicular: d.centerXPx },
              { from: b.y + b.h, to: d.topPx + adjust, perpendicular: d.centerXPx },
            ],
          },
        });
      }
      if (d.bottomPx <= a.y) {
        const outerGap = a.y - d.bottomPx;
        const adjust = -(innerGap - outerGap);
        tryY({
          adjust,
          guide: {
            kind: 'equal-spacing',
            axis: 'y',
            spans: [
              { from: d.bottomPx + adjust, to: a.y, perpendicular: d.centerXPx },
              { from: a.y + a.h, to: b.y,           perpendicular: d.centerXPx },
            ],
          },
        });
      }
    }
  }
```

- [x] **Step 4: Run to confirm green**

Run: `pnpm --filter @wafflebase/slides test smart-guides.test`
Expected: PASS (skeleton + middle + end).

- [x] **Step 5: Commit**

```bash
git add packages/slides/src/view/editor/smart-guides.ts \
        packages/slides/test/view/editor/smart-guides.test.ts
git commit -m "$(cat <<'EOF'
Detect end-trio equal-spacing in slides smart-guides

Extend the equal-spacing pattern so the dragged element snaps when
it sits on either END of a pair, not only between them — matches
PowerPoint behaviour. Same 8 px threshold and smallest-adjust
tie-break as the middle-trio case.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Equal-distance detection (pair → pair)

**Files:**
- Modify: `packages/slides/src/view/editor/smart-guides.ts`
- Modify: `packages/slides/test/view/editor/smart-guides.test.ts`

- [x] **Step 1: Add failing tests for equal-distance**

Append to `smart-guides.test.ts`:

```typescript
describe('smartGuides — equal-distance (pair matches known gap)', () => {
  // Known pair A--B on the same row at y=100; gap = 80.
  const A: Frame = { x: 0,   y: 100, w: 100, h: 100, rotation: 0 };
  const B: Frame = { x: 180, y: 100, w: 100, h: 100, rotation: 0 };
  // Neighbour C in the same row, off to the right.
  const C: Frame = { x: 500, y: 100, w: 100, h: 100, rotation: 0 };

  it('snaps dragged so gap(C, dragged) == gap(A, B)', () => {
    // gap(A, B) = 80. dragged needs left = C.right + 80 = 680.
    // Place dragged at left=683 -> adjust = -3.
    const bbox = { x: 683, y: 100, w: 50, h: 50 };
    const out = smartGuides(bbox, 0, 0, [A, B, C]);
    expect(out.dx).toBe(-3);
    expect(out.guides[0].kind).toBe('equal-distance');
  });

  it('snaps dragged on the left of C using the same known gap', () => {
    // dragged.right = C.left - 80 = 420. dragged.x = 370 if w=50.
    // Place dragged at x=372 -> adjust = -2.
    const bbox = { x: 372, y: 100, w: 50, h: 50 };
    const out = smartGuides(bbox, 0, 0, [A, B, C]);
    expect(out.dx).toBe(-2);
    expect(out.guides[0].kind).toBe('equal-distance');
  });

  it('uses smallest |adjust| when only equal-spacing qualifies', () => {
    // With dragged at x=103 (w=50), only the a-dragged-b middle trio
    // qualifies — no equal-distance candidate is within threshold.
    // gapL = 103-50 = 53, gapR = 200-153 = 47, adjust = (47-53)/2 = -3.
    const a: Frame = { x: 0,   y: 100, w: 50, h: 50, rotation: 0 };
    const b: Frame = { x: 200, y: 100, w: 50, h: 50, rotation: 0 };
    const c: Frame = { x: 400, y: 100, w: 50, h: 50, rotation: 0 };
    const bbox = { x: 103, y: 100, w: 50, h: 50 };
    const out = smartGuides(bbox, 0, 0, [a, b, c]);
    expect(out.guides[0].kind).toBe('equal-spacing');
    expect(out.dx).toBe(-3);
  });
});
```

- [x] **Step 2: Run to confirm failure**

Run: `pnpm --filter @wafflebase/slides test smart-guides.test`
Expected: FAIL on the first 2 cases (third may pass trivially).

- [x] **Step 3: Add the equal-distance detection pass**

Keep the existing `tryX` / `tryY` helpers from Task 2 — they already pick the smallest-`|adjust|` winner per axis, which is exactly the rule we want. Equal-distance reuses them: no `priority` field, no separate selector. The design doc's "Priority" section explains why we don't rank kinds against each other (a precise equal-distance match losing to a coarser equal-spacing one is worse than the occasional kind swap on coincidental setups).

Append the equal-distance pass after both equal-spacing loops:

```typescript
  // Equal-distance — collect known gaps, then test each non-dragged
  // neighbour on the same row/col against every known gap.
  type KnownGap = {
    axis: 'x' | 'y';
    gap: number;
    left: Frame; right: Frame;  // for X; reused names for Y (top/bottom)
  };
  const knownGapsX: KnownGap[] = [];
  const knownGapsY: KnownGap[] = [];
  for (let i = 0; i < others.length; i++) {
    for (let j = 0; j < others.length; j++) {
      if (i === j) continue;
      const a = others[i];
      const b = others[j];
      if (overlapsRow(d, a) && overlapsRow(d, b) && a.x + a.w < b.x) {
        knownGapsX.push({ axis: 'x', gap: b.x - (a.x + a.w), left: a, right: b });
      }
      if (overlapsCol(d, a) && overlapsCol(d, b) && a.y + a.h < b.y) {
        knownGapsY.push({ axis: 'y', gap: b.y - (a.y + a.h), left: a, right: b });
      }
    }
  }
  // For each neighbour on the same row, try to match each known gap.
  for (const c of others) {
    if (!overlapsRow(d, c)) continue;
    for (const kg of knownGapsX) {
      // Skip when the neighbour IS one of the gap's endpoints.
      if (c === kg.left || c === kg.right) continue;
      if (c.x + c.w <= d.leftPx) {
        // C is on the left of dragged → gap(C, dragged) = drag.left - C.right.
        const target = c.x + c.w + kg.gap;
        const adjust = target - d.leftPx;
        tryX({
          adjust,
          guide: {
            kind: 'equal-distance',
            axis: 'x',
            spans: [
              { from: kg.left.x + kg.left.w, to: kg.right.x, perpendicular: kg.left.y + kg.left.h / 2 },
              { from: c.x + c.w, to: d.leftPx + adjust,      perpendicular: d.centerYPx },
            ],
          },
        });
      }
      if (c.x >= d.rightPx) {
        // C is on the right → gap(dragged, C) = C.left - drag.right.
        const target = c.x - kg.gap;
        const adjust = target - d.rightPx;
        tryX({
          adjust,
          guide: {
            kind: 'equal-distance',
            axis: 'x',
            spans: [
              { from: kg.left.x + kg.left.w, to: kg.right.x, perpendicular: kg.left.y + kg.left.h / 2 },
              { from: d.rightPx + adjust, to: c.x,           perpendicular: d.centerYPx },
            ],
          },
        });
      }
    }
  }
  for (const c of others) {
    if (!overlapsCol(d, c)) continue;
    for (const kg of knownGapsY) {
      if (c === kg.left || c === kg.right) continue;
      if (c.y + c.h <= d.topPx) {
        const target = c.y + c.h + kg.gap;
        const adjust = target - d.topPx;
        tryY({
          adjust,
          guide: {
            kind: 'equal-distance',
            axis: 'y',
            spans: [
              { from: kg.left.y + kg.left.h, to: kg.right.y, perpendicular: kg.left.x + kg.left.w / 2 },
              { from: c.y + c.h, to: d.topPx + adjust,       perpendicular: d.centerXPx },
            ],
          },
        });
      }
      if (c.y >= d.bottomPx) {
        const target = c.y - kg.gap;
        const adjust = target - d.bottomPx;
        tryY({
          adjust,
          guide: {
            kind: 'equal-distance',
            axis: 'y',
            spans: [
              { from: kg.left.y + kg.left.h, to: kg.right.y, perpendicular: kg.left.x + kg.left.w / 2 },
              { from: d.bottomPx + adjust, to: c.y,          perpendicular: d.centerXPx },
            ],
          },
        });
      }
    }
  }
```

(Renaming `KnownGap.left/right` to `left/right` on the Y axis is intentional — they semantically mean "first endpoint" and "second endpoint" along the axis; clarity over field naming was not worth a duplicate type.)

- [x] **Step 4: Run to confirm green**

Run: `pnpm --filter @wafflebase/slides test smart-guides.test`
Expected: PASS — all spacing + distance tests.

- [x] **Step 5: Commit**

```bash
git add packages/slides/src/view/editor/smart-guides.ts \
        packages/slides/test/view/editor/smart-guides.test.ts
git commit -m "$(cat <<'EOF'
Detect equal-distance pairs in slides smart-guides

When the dragged element sits to the side of a neighbour and the
resulting gap matches a gap already formed by two other elements,
snap the dragged element to that distance. Reuses the existing
tryX/tryY selectors — smallest |adjust| wins regardless of kind,
so a precise distance match isn't unseated by a coarser spacing one
in coincidental setups.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `matchSize` for resize

**Files:**
- Modify: `packages/slides/src/view/editor/smart-guides.ts`
- Modify: `packages/slides/test/view/editor/smart-guides.test.ts`

- [x] **Step 1: Add failing tests for `matchSize`**

Append to `smart-guides.test.ts`:

```typescript
import { matchSize } from '../../../src/view/editor/smart-guides';
import type { ResizeHandle } from '../../../src/view/editor/interactions/resize';

describe('matchSize', () => {
  const other100: Frame = { x: 0, y: 0, w: 100, h: 100, rotation: 0 };

  it('snaps w to a peer width when |delta| <= 8 (handle e, x stays fixed)', () => {
    const bbox = { x: 500, y: 500, w: 103, h: 60 };
    const out = matchSize(bbox, 'e', [other100]);
    expect(out.x).toBe(500);
    expect(out.w).toBe(100);
    expect(out.h).toBe(60);
    expect(out.guides).toHaveLength(1);
    expect(out.guides[0].kind).toBe('equal-size');
  });

  it('snaps h to a peer height when |delta| <= 8 (handle s, y fixed)', () => {
    const bbox = { x: 500, y: 500, w: 60, h: 95 };
    const out = matchSize(bbox, 's', [other100]);
    expect(out.h).toBe(100);
    expect(out.y).toBe(500);
    expect(out.guides[0].axis).toBe('y');
  });

  it('compensates origin for w-side handles', () => {
    // Handle w: bbox.x is the moving edge. When w shrinks, x moves
    // right by (oldW - newW) so the right edge stays put.
    const bbox = { x: 500, y: 500, w: 105, h: 60 };
    const out = matchSize(bbox, 'w', [other100]);
    expect(out.w).toBe(100);
    expect(out.x).toBe(505); // 500 + (105 - 100).
  });

  it('compensates origin for n-side handles', () => {
    const bbox = { x: 500, y: 500, w: 60, h: 92 };
    const out = matchSize(bbox, 'n', [other100]);
    expect(out.h).toBe(100);
    expect(out.y).toBe(492); // 500 + (92 - 100).
  });

  it('matches both axes independently for a corner handle (se)', () => {
    const otherTall: Frame = { x: 0, y: 0, w: 100, h: 200, rotation: 0 };
    const otherWide: Frame = { x: 0, y: 0, w: 300, h: 100, rotation: 0 };
    const bbox = { x: 0, y: 0, w: 297, h: 203 };
    const out = matchSize(bbox, 'se', [otherTall, otherWide]);
    expect(out.w).toBe(300);
    expect(out.h).toBe(200);
  });

  it('collects every peer that shares the matched dimension', () => {
    const otherA: Frame = { x: 0,   y: 0,   w: 100, h: 80, rotation: 0 };
    const otherB: Frame = { x: 500, y: 500, w: 100, h: 60, rotation: 0 };
    const bbox = { x: 0, y: 0, w: 102, h: 200 };
    const out = matchSize(bbox, 'e', [otherA, otherB]);
    expect(out.w).toBe(100);
    expect(out.guides[0].kind).toBe('equal-size');
    if (out.guides[0].kind === 'equal-size') {
      expect(out.guides[0].matchedFrames).toHaveLength(2);
    }
  });

  it('returns the bbox unchanged when no peer is within 8 px', () => {
    const bbox = { x: 0, y: 0, w: 200, h: 200 };
    const out = matchSize(bbox, 'se', [other100]);
    expect(out).toEqual({ x: 0, y: 0, w: 200, h: 200, guides: [] });
  });
});
```

- [x] **Step 2: Run to confirm failure**

Run: `pnpm --filter @wafflebase/slides test smart-guides.test`
Expected: FAIL with `matchSize is not exported`.

- [x] **Step 3: Implement `matchSize`**

Append to `smart-guides.ts`:

```typescript
import type { ResizeHandle } from './interactions/resize';

/**
 * Refine a resize bbox so its width/height snap to a peer's when
 * within the same 8 px band the rest of the editor uses. Axes are
 * independent — `w` may match peer A while `h` matches peer B.
 *
 * `handle` controls origin compensation: w/nw/sw handles move the
 * left edge, so when `w` shrinks `x` slides right to keep the
 * opposite edge anchored. Same for n/ne/nw on the top edge.
 *
 * `matchedFrames` is the FULL set of peers that share the chosen
 * dimension — the overlay highlights all of them.
 */
export function matchSize(
  bbox: { x: number; y: number; w: number; h: number },
  handle: ResizeHandle,
  others: readonly Frame[],
): { x: number; y: number; w: number; h: number; guides: SmartGuide[] } {
  let bestW: { target: number; matched: Frame[] } | null = null;
  let bestH: { target: number; matched: Frame[] } | null = null;
  for (const o of others) {
    const dW = o.w - bbox.w;
    if (Math.abs(dW) <= THRESHOLD) {
      if (!bestW || Math.abs(dW) < Math.abs(bestW.target - bbox.w)) {
        bestW = { target: o.w, matched: [o] };
      } else if (bestW && bestW.target === o.w) {
        bestW.matched.push(o);
      }
    }
    const dH = o.h - bbox.h;
    if (Math.abs(dH) <= THRESHOLD) {
      if (!bestH || Math.abs(dH) < Math.abs(bestH.target - bbox.h)) {
        bestH = { target: o.h, matched: [o] };
      } else if (bestH && bestH.target === o.h) {
        bestH.matched.push(o);
      }
    }
  }

  let { x, y, w, h } = bbox;
  const guides: SmartGuide[] = [];
  if (bestW) {
    const oldW = w;
    w = bestW.target;
    if (handle === 'w' || handle === 'nw' || handle === 'sw') {
      x += oldW - w;
    }
    guides.push({ kind: 'equal-size', axis: 'x', matchedFrames: bestW.matched });
  }
  if (bestH) {
    const oldH = h;
    h = bestH.target;
    if (handle === 'n' || handle === 'nw' || handle === 'ne') {
      y += oldH - h;
    }
    guides.push({ kind: 'equal-size', axis: 'y', matchedFrames: bestH.matched });
  }
  return { x, y, w, h, guides };
}
```

- [x] **Step 4: Run to confirm green**

Run: `pnpm --filter @wafflebase/slides test smart-guides.test`
Expected: PASS — all spacing + distance + size tests.

- [x] **Step 5: Commit**

```bash
git add packages/slides/src/view/editor/smart-guides.ts \
        packages/slides/test/view/editor/smart-guides.test.ts
git commit -m "$(cat <<'EOF'
Add matchSize for slides equal-size resize snap

Pure resize-side smart-guide entry point: snaps the bbox's width or
height to a peer's when within 8 px, with handle-aware origin
compensation so the anchored corner / edge stays put. Collects every
peer that shares the matched dimension so the overlay can highlight
the full group.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Render `SmartGuide` in the overlay

**Files:**
- Modify: `packages/slides/src/view/editor/overlay.ts`

- [x] **Step 1: Read the existing overlay structure**

Open `packages/slides/src/view/editor/overlay.ts`. Locate the existing `makeGuide` function (around line 474) and the place where it is called from `renderOverlay` (around lines 122-126 — `if (options.guides) { for (const g of options.guides) { ... overlay.appendChild(makeGuide(g, options)); } }`). The smart-guide rendering will sit in the same loop, dispatched by `g.kind`.

- [x] **Step 2: Widen `OverlayOptions.guides` type**

Find the `OverlayOptions` interface (the `guides:` field at ~line 34) and import `SmartGuide`:

```typescript
import type { SnapGuide } from './snap';
import type { SmartGuide } from './smart-guides';
```

Then change the field declaration:

```typescript
guides?: readonly (SnapGuide | SmartGuide)[];
```

- [x] **Step 3: Dispatch on guide kind inside `renderOverlay`**

Locate the loop that calls `makeGuide`:

```typescript
if (options.guides) {
  for (const g of options.guides) {
    overlay.appendChild(makeGuide(g, options));
  }
}
```

Change to:

```typescript
if (options.guides) {
  for (const g of options.guides) {
    if (g.kind === 'equal-spacing' || g.kind === 'equal-distance') {
      for (const node of makeSmartGuideArrows(g, options)) overlay.appendChild(node);
    } else if (g.kind === 'equal-size') {
      for (const node of makeSmartGuideOutlines(g, options)) overlay.appendChild(node);
    } else {
      overlay.appendChild(makeGuide(g, options));
    }
  }
}
```

Note: existing `SnapGuide` has `kind` values `'slide-center' | 'guide' | 'edge'` so the else-branch catches them. Make sure the existing `if (options.guides) { for (const g of options.guides) { ... } }` at line ~247 (separate block for rotated single-element drag) gets the same treatment.

- [x] **Step 4: Add the two new helpers**

Add directly below `makeGuide`:

```typescript
const SMART_GUIDE_COLOR = '#e11d48';

/**
 * Render an equal-spacing or equal-distance guide as a pair of
 * 1 px double-headed arrows. Each `Span` describes one arrow shaft
 * along the matched axis at `perpendicular`. Arrowheads are 4 px CSS
 * border triangles. Drawn in HTML/CSS to match the existing
 * `makeGuide` / `makePermanentGuide` style.
 */
function makeSmartGuideArrows(
  guide: { axis: 'x' | 'y'; spans: readonly Span[] },
  options: OverlayOptions,
): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const span of guide.spans) {
    if (guide.axis === 'x') {
      const shaft = document.createElement('div');
      shaft.className = 'wfb-slides-smart-arrow';
      shaft.style.position = 'absolute';
      shaft.style.background = SMART_GUIDE_COLOR;
      shaft.style.pointerEvents = 'none';
      const left  = Math.min(span.from, span.to) * options.scale;
      const right = Math.max(span.from, span.to) * options.scale;
      shaft.style.left = `${left}px`;
      shaft.style.top = `${span.perpendicular * options.scale - 0.5}px`;
      shaft.style.width = `${right - left}px`;
      shaft.style.height = `1px`;
      out.push(shaft);
      out.push(arrowhead('left',  left,  span.perpendicular * options.scale));
      out.push(arrowhead('right', right, span.perpendicular * options.scale));
    } else {
      const shaft = document.createElement('div');
      shaft.className = 'wfb-slides-smart-arrow';
      shaft.style.position = 'absolute';
      shaft.style.background = SMART_GUIDE_COLOR;
      shaft.style.pointerEvents = 'none';
      const top    = Math.min(span.from, span.to) * options.scale;
      const bottom = Math.max(span.from, span.to) * options.scale;
      shaft.style.left = `${span.perpendicular * options.scale - 0.5}px`;
      shaft.style.top = `${top}px`;
      shaft.style.width = `1px`;
      shaft.style.height = `${bottom - top}px`;
      out.push(shaft);
      out.push(arrowhead('up',   span.perpendicular * options.scale, top));
      out.push(arrowhead('down', span.perpendicular * options.scale, bottom));
    }
  }
  return out;
}

/** 4 px CSS-border triangle pointing toward the named direction. */
function arrowhead(
  dir: 'left' | 'right' | 'up' | 'down',
  cx: number,
  cy: number,
): HTMLDivElement {
  const h = document.createElement('div');
  h.style.position = 'absolute';
  h.style.pointerEvents = 'none';
  h.style.width = '0';
  h.style.height = '0';
  // 4 px arrowheads — a triangle made from a 0×0 div + four borders.
  switch (dir) {
    case 'left':
      h.style.left = `${cx}px`;
      h.style.top = `${cy - 4}px`;
      h.style.borderTop = '4px solid transparent';
      h.style.borderBottom = '4px solid transparent';
      h.style.borderRight = `4px solid ${SMART_GUIDE_COLOR}`;
      break;
    case 'right':
      h.style.left = `${cx - 4}px`;
      h.style.top = `${cy - 4}px`;
      h.style.borderTop = '4px solid transparent';
      h.style.borderBottom = '4px solid transparent';
      h.style.borderLeft = `4px solid ${SMART_GUIDE_COLOR}`;
      break;
    case 'up':
      h.style.left = `${cx - 4}px`;
      h.style.top = `${cy}px`;
      h.style.borderLeft = '4px solid transparent';
      h.style.borderRight = '4px solid transparent';
      h.style.borderBottom = `4px solid ${SMART_GUIDE_COLOR}`;
      break;
    case 'down':
      h.style.left = `${cx - 4}px`;
      h.style.top = `${cy - 4}px`;
      h.style.borderLeft = '4px solid transparent';
      h.style.borderRight = '4px solid transparent';
      h.style.borderTop = `4px solid ${SMART_GUIDE_COLOR}`;
      break;
  }
  return h;
}

/**
 * Render an equal-size guide as a 1 px dashed outline around every
 * matched peer frame. No fill, no label — the outline groups the
 * peers visually so the user sees what "same width/height as" means.
 */
function makeSmartGuideOutlines(
  guide: { matchedFrames: readonly Frame[] },
  options: OverlayOptions,
): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const f of guide.matchedFrames) {
    const el = document.createElement('div');
    el.className = 'wfb-slides-smart-size';
    el.style.position = 'absolute';
    el.style.left = `${f.x * options.scale}px`;
    el.style.top = `${f.y * options.scale}px`;
    el.style.width = `${f.w * options.scale}px`;
    el.style.height = `${f.h * options.scale}px`;
    el.style.border = `1px dashed ${SMART_GUIDE_COLOR}`;
    el.style.boxSizing = 'border-box';
    el.style.pointerEvents = 'none';
    out.push(el);
  }
  return out;
}
```

Also add the `Frame` import at the top of `overlay.ts` if not present (search for `import type { Frame }` first).

- [x] **Step 5: Run the slides suite to confirm no regression**

Run: `pnpm --filter @wafflebase/slides test`
Expected: PASS — no existing overlay/snap tests should break (the dispatch is additive).

- [x] **Step 6: Run typecheck**

Run: `pnpm --filter @wafflebase/slides build`
Expected: SUCCESS.

- [x] **Step 7: Commit**

```bash
git add packages/slides/src/view/editor/overlay.ts
git commit -m "$(cat <<'EOF'
Render SmartGuide arrows and dashed outlines in slides overlay

Adds two HTML/CSS overlay primitives next to makeGuide — paired
double-headed arrows for equal-spacing / equal-distance, and 1 px
dashed boxes for equal-size matched peers. Dispatched from
renderOverlay by guide.kind so the existing SnapGuide rendering
stays unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Wire `smartGuides` into the move-drag handler

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts` (move-drag `onMove` at lines 2450-2473)

- [x] **Step 1: Add the import**

Near the existing snap imports (lines 73-74), add:

```typescript
import { smartGuides, type SmartGuide } from './smart-guides';
```

- [x] **Step 2: Compose `smartGuides` after `snapDelta`**

In the move-drag `onMove` body (~line 2450), the current sequence is:

```typescript
const snapped = snapDelta(
  bbox,
  locked.dx,
  locked.dy,
  otherFrames,
  { w: SLIDE_WIDTH, h: SLIDE_HEIGHT },
  this.options.store.read().guides,
);
const final = ev.shiftKey ? lockAxis(snapped.dx, snapped.dy) : snapped;
const dx = final.dx;
const dy = final.dy;
const guides = snapped.guides;
```

Change to:

```typescript
const snapped = snapDelta(
  bbox,
  locked.dx,
  locked.dy,
  otherFrames,
  { w: SLIDE_WIDTH, h: SLIDE_HEIGHT },
  this.options.store.read().guides,
);
const smart = smartGuides(bbox, snapped.dx, snapped.dy, otherFrames);
const final = ev.shiftKey ? lockAxis(smart.dx, smart.dy) : smart;
const dx = final.dx;
const dy = final.dy;
const guides: (SnapGuide | SmartGuide)[] = [...snapped.guides, ...smart.guides];
```

Note: when Shift is held the axis-lock runs after smart-guides too, mirroring the existing post-snap re-lock at line 2468. Smart-guide arrows for a locked-out axis would be re-zeroed by `lockAxis`, but the *guide objects* still flow into the overlay — that is intentional, since the user still sees why nothing happened (a tiny edge case worth keeping consistent).

- [x] **Step 3: Run the slides suite**

Run: `pnpm --filter @wafflebase/slides test`
Expected: PASS (no test currently asserts the exact `guides` shape at the drag-handler level; smart-guides unit tests have already verified detection).

- [x] **Step 4: Run typecheck**

Run: `pnpm --filter @wafflebase/slides build`
Expected: SUCCESS.

- [x] **Step 5: Commit**

```bash
git add packages/slides/src/view/editor/editor.ts
git commit -m "$(cat <<'EOF'
Run smart-guides after snapDelta in slides move-drag

Composes smartGuides() onto the snap-corrected (dx, dy), then merges
the resulting guides with the existing edge / centre / user-guide
set. Shift's axis re-lock continues to have the last word on the
delta. Reuses the otherFrames already collected for snapDelta — no
extra candidate work.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Wire `matchSize` into the resize handler

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts` (`startResize` at line 3265, `onMove` at 3293-3300)

- [x] **Step 1: Add the import**

Extend the smart-guides import:

```typescript
import { smartGuides, matchSize, type SmartGuide } from './smart-guides';
```

Add a candidate-collection import if not already present (`collectSnapCandidates` is already imported at line 74).

- [x] **Step 2: Collect candidates once at resize start**

Inside `startResize`, after the `start = this.clientToLogical(...)` line (~3290), add:

```typescript
const otherFrames = collectSnapCandidates(
  startSlide,
  [...scope],
  new Set([elementId]),
);
```

(`collectSnapCandidates` expects a `ReadonlySet<string>` for the exclude set, matching the move-drag usage at line 2437.)

- [x] **Step 3: Run `matchSize` inside the resize `onMove`**

Current `onMove`:

```typescript
const onMove = (ev: MouseEvent) => {
  const cur = this.clientToLogical(ev.clientX, ev.clientY);
  const dx = cur.x - start.x;
  const dy = cur.y - start.y;
  live.worldFrame = resizeFrameWorld(startWorldFrame, handle, dx, dy, ev.shiftKey);
  const livMap = new Map<string, Frame>([[elementId, live.worldFrame]]);
  this.paintLiveScoped(livMap, scope);
};
```

Change to:

```typescript
const onMove = (ev: MouseEvent) => {
  const cur = this.clientToLogical(ev.clientX, ev.clientY);
  const dx = cur.x - start.x;
  const dy = cur.y - start.y;
  const raw = resizeFrameWorld(startWorldFrame, handle, dx, dy, ev.shiftKey);
  // Skip equal-size snap while Shift is held — Shift means "preserve
  // aspect", which would fight with snapping to a peer's exact w/h.
  const matched = ev.shiftKey
    ? { x: raw.x, y: raw.y, w: raw.w, h: raw.h, guides: [] as SmartGuide[] }
    : matchSize({ x: raw.x, y: raw.y, w: raw.w, h: raw.h }, handle, otherFrames);
  live.worldFrame = {
    ...raw,
    x: matched.x, y: matched.y, w: matched.w, h: matched.h,
  };
  const livMap = new Map<string, Frame>([[elementId, live.worldFrame]]);
  this.paintLiveScoped(livMap, scope, matched.guides);
};
```

- [x] **Step 4: Run the slides suite**

Run: `pnpm --filter @wafflebase/slides test`
Expected: PASS.

- [x] **Step 5: Run typecheck**

Run: `pnpm --filter @wafflebase/slides build`
Expected: SUCCESS.

- [x] **Step 6: Commit**

```bash
git add packages/slides/src/view/editor/editor.ts
git commit -m "$(cat <<'EOF'
Snap resize to peer width/height in slides editor

Runs matchSize after resizeFrameWorld inside startResize. Same 8 px
band; handle-aware origin compensation keeps the anchored edge fixed.
Shift (preserve-aspect) intentionally bypasses equal-size matching so
the two modes do not fight.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Repo-wide gate + manual smoke + branch wrap-up

- [x] **Step 1: Run the project pre-commit gate**

Run: `pnpm verify:fast`
Expected: PASS (lint + unit tests across all packages).

- [x] **Step 2: Manual smoke in `pnpm dev`**

In one terminal: `docker compose up -d`
In another: `pnpm dev`
Open the slides editor at `http://localhost:5173`.

Verify all four behaviours:

- Place three shapes in a row. Drag the middle one — within ~8 px of the equal-gap position, the dragged shape snaps and two red arrows appear on either side. Drag well off-centre — no arrows.
- Place two shapes with a known gap, then a third elsewhere on the same row. Drag a fourth shape near the third — when the (4th, 3rd) gap approaches the (1st, 2nd) gap the dragged shape snaps and arrows appear at BOTH pairs.
- Resize a rectangle by its right (`e`) handle — when its width nears another rectangle's, snap to that width and the matched rectangle shows a dashed red outline.
- Resize the same rectangle while holding Shift — equal-size snap should NOT engage (Shift = preserve aspect wins).
- Drag with Shift held (axis-lock) — smart guides may still appear on the locked axis; on the locked-out axis the delta stays zero (existing behaviour).
- Stop drag (mouseup) — all smart-guide overlays disappear immediately.

- [x] **Step 3: Self-review the branch diff**

Run: `git diff main...HEAD --stat`
Skim. Confirm: one new module + one new test file in `smart-guides.*`, additive changes only in `overlay.ts` and `editor.ts` (no removed lines outside the two replaced blocks).

- [x] **Step 4: Dispatch code review**

Use the project workflow's review skill (`/code-review` or `superpowers:requesting-code-review`) on the branch diff before opening the PR. Address blocking findings; record non-blocking ones in `*-lessons.md`.

- [x] **Step 5: Capture lessons**

Create `docs/tasks/active/20260531-slides-smart-guides-lessons.md` with any non-obvious gotchas surfaced during implementation (e.g. if the equal-distance `c === kg.left` reference equality failed because the candidate array contains structural duplicates; if arrowhead positioning needed sub-pixel tweaks; if `paintLiveScoped(guides)` was already called with stale guides from a prior batch).

- [x] **Step 6: Archive and open PR**

```bash
pnpm tasks:archive && pnpm tasks:index
git add docs/tasks/
git commit -m "Archive slides-smart-guides task docs"
```

Then push and open the PR with the project's PR template (Summary + Test plan), referencing the design doc.

---

## Review

(filled in at completion)
