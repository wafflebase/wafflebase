# Arrow Up/Down Pixel Accuracy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Arrow Up/Down and mouse click cursor positioning by replacing the uniform character width approximation with pre-computed per-character pixel offsets.

**Architecture:** Add a `charOffsets: number[]` array to `LayoutRun` during layout build. Each entry stores the cumulative pixel width from the run start to the end of that character. `paginatedPixelToPosition` uses binary search on these offsets instead of the broken `run.width / text.length` approximation.

**Tech Stack:** TypeScript, Canvas `measureText`, Vitest

---

### Task 1: Add `charOffsets` to LayoutRun and compute during layout

**Files:**
- Modify: `packages/docs/src/view/layout.ts:61-69` (LayoutRun interface)
- Modify: `packages/docs/src/view/layout.ts:236-348` (layoutBlock — both run creation sites)
- Modify: `packages/docs/src/view/layout.ts:354-393` (measureSegments — add font to MeasuredSegment)

- [ ] **Step 1: Add `charOffsets` field to `LayoutRun`**

In `packages/docs/src/view/layout.ts`, add the field to the interface:

```typescript
export interface LayoutRun {
  inline: Inline;
  text: string;
  x: number;
  width: number;
  inlineIndex: number;
  charStart: number;
  charEnd: number;
  /** Cumulative pixel widths: charOffsets[i] = width of text.slice(0, i+1). Length === text.length. */
  charOffsets: number[];
}
```

- [ ] **Step 2: Add `font` to `MeasuredSegment`**

The font string is computed in `measureSegments` but not stored. Add it so `layoutBlock` can reuse it for charOffset measurement:

```typescript
interface MeasuredSegment {
  text: string;
  style: InlineStyle;
  width: number;
  inlineIndex: number;
  charStart: number;
  charEnd: number;
  font: string;
}
```

In `measureSegments`, store the font:

```typescript
segments.push({
  text: word,
  style: inline.style,
  width,
  inlineIndex: i,
  charStart: charPos,
  charEnd: charPos + word.length,
  font,
});
```

- [ ] **Step 3: Add helper function `computeCharOffsets`**

Add this function in `layout.ts` (above `layoutBlock`):

```typescript
/**
 * Compute cumulative character pixel offsets for a run.
 * charOffsets[i] = width of text.slice(0, i + 1).
 */
function computeCharOffsets(
  ctx: CanvasRenderingContext2D,
  text: string,
  font: string,
): number[] {
  if (text.length === 0) return [];
  ctx.font = font;
  const offsets = new Array<number>(text.length);
  for (let i = 0; i < text.length; i++) {
    offsets[i] = ctx.measureText(text.slice(0, i + 1)).width;
  }
  return offsets;
}
```

- [ ] **Step 4: Compute charOffsets at both LayoutRun creation sites**

In the **regular word-wrapped path** (line ~326):

```typescript
currentRuns.push({
  inline: inlines[seg.inlineIndex],
  text: seg.text,
  x: lineStartX + lineWidth,
  width: seg.width,
  inlineIndex: seg.inlineIndex,
  charStart: seg.charStart,
  charEnd: seg.charEnd,
  charOffsets: computeCharOffsets(ctx, seg.text, seg.font),
});
```

In the **character-level fallback path** (line ~308):

```typescript
const sliceText = seg.text.slice(charIdx, endIdx);
currentRuns.push({
  inline: inlines[seg.inlineIndex],
  text: sliceText,
  x: lineStartX + lineWidth,
  width: runWidth,
  inlineIndex: seg.inlineIndex,
  charStart: seg.charStart + charIdx,
  charEnd: seg.charStart + endIdx,
  charOffsets: computeCharOffsets(ctx, sliceText, ctx.font),
});
```

(In the character-level path, `ctx.font` is already set to the correct font from the block above.)

- [ ] **Step 5: Run existing tests to confirm no regressions**

Run: `cd packages/docs && pnpm vitest run test/view/pagination.test.ts`

Expected: All existing tests pass (mocked runs with empty text get `charOffsets: []`).

Note: Empty-run mock helpers in tests create `{ runs: [] }` so no LayoutRun objects are involved — no test updates needed yet.

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/view/layout.ts
git commit -m "Add charOffsets to LayoutRun for pixel-accurate hit testing

Pre-compute cumulative character pixel widths during layout so that
paginatedPixelToPosition can use binary search instead of uniform
character width approximation."
```

---

### Task 2: Use `charOffsets` in `paginatedPixelToPosition`

**Files:**
- Modify: `packages/docs/src/view/pagination.ts:286-301` (hit-test loop)

- [ ] **Step 1: Replace uniform charWidth with binary search on charOffsets**

In `paginatedPixelToPosition`, replace lines 289-293:

```typescript
// OLD:
const charWidth = run.width / Math.max(1, run.text.length);
const localRunX = localX - run.x;
const charOffset = Math.round(localRunX / charWidth);
const clampedOffset = Math.min(Math.max(0, charOffset), run.text.length);
```

With:

```typescript
// NEW: binary search on pre-computed charOffsets
const localRunX = localX - run.x;
let charOffset = 0;
const offsets = run.charOffsets;
if (offsets.length > 0 && localRunX > 0) {
  // Binary search for the character boundary closest to localRunX
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] < localRunX) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  // lo is now the first index where offsets[lo] >= localRunX.
  // Snap to nearest: compare midpoint between prev and current char.
  const prev = lo > 0 ? offsets[lo - 1] : 0;
  charOffset = (localRunX - prev < offsets[lo] - localRunX) ? lo : lo + 1;
}
const clampedOffset = Math.min(charOffset, run.text.length);
```

- [ ] **Step 2: Run existing tests**

Run: `cd packages/docs && pnpm vitest run test/view/pagination.test.ts`

Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add packages/docs/src/view/pagination.ts
git commit -m "Use charOffsets binary search in paginatedPixelToPosition

Replace uniform character width approximation with binary search on
pre-computed per-character pixel offsets. Fixes Arrow Up/Down and
mouse click landing on wrong character with proportional fonts."
```

---

### Task 3: Add tests for proportional-width hit detection

**Files:**
- Modify: `packages/docs/test/view/pagination.test.ts`

- [ ] **Step 1: Add helper to create runs with charOffsets**

Add a helper function in the test file:

```typescript
import type { LayoutRun } from '../../src/view/layout.js';

function mockRun(text: string, x: number, charOffsets: number[], charStart = 0): LayoutRun {
  return {
    inline: { text, style: {} },
    text,
    x,
    width: charOffsets.length > 0 ? charOffsets[charOffsets.length - 1] : 0,
    inlineIndex: 0,
    charStart,
    charEnd: charStart + text.length,
    charOffsets,
  };
}

function mockLineWithRuns(runs: LayoutRun[], height = 24): LayoutLine {
  const width = runs.length > 0
    ? runs[runs.length - 1].x + runs[runs.length - 1].width
    : 0;
  return { runs, y: 0, height, width };
}
```

- [ ] **Step 2: Write test — proportional font hit detection snaps correctly**

Test that clicking between characters with variable widths returns the correct offset. Simulate "Wii" where W is wide (14px) and i is narrow (4px):

```typescript
describe('paginatedPixelToPosition — charOffsets', () => {
  const setup = DEFAULT_PAGE_SETUP;
  // margins.left = 96, pageXOffset for canvasWidth=816 is 0

  it('snaps to correct character with proportional widths', () => {
    // "Wii": W=14px, i=4px, i=4px → charOffsets=[14, 18, 22]
    const run = mockRun('Wii', 0, [14, 18, 22]);
    const line = mockLineWithRuns([run]);
    const block = mockBlock('b1', [line]);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 24, blockParentMap: new Map() };
    const paginated = paginateLayout(layout, setup);

    // Click at x=96+5 → inside 'W' (0-14px range), should be offset 0 (closer to 0 than 14)
    const r1 = paginatedPixelToPosition(paginated, layout, 96 + 5, 136, 816);
    expect(r1!.offset).toBe(0);

    // Click at x=96+10 → inside 'W' (0-14px range), should be offset 1 (closer to 14 than 0)
    const r2 = paginatedPixelToPosition(paginated, layout, 96 + 10, 136, 816);
    expect(r2!.offset).toBe(1);

    // Click at x=96+15 → inside first 'i' (14-18px range), should be offset 1 (closer to 14 than 18)
    const r3 = paginatedPixelToPosition(paginated, layout, 96 + 15, 136, 816);
    expect(r3!.offset).toBe(1);

    // Click at x=96+17 → inside first 'i' (14-18px range), should be offset 2 (closer to 18 than 14)
    const r4 = paginatedPixelToPosition(paginated, layout, 96 + 17, 136, 816);
    expect(r4!.offset).toBe(2);
  });

  it('clicking past end of run returns end offset', () => {
    const run = mockRun('ab', 0, [10, 20]);
    const line = mockLineWithRuns([run]);
    const block = mockBlock('b1', [line]);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 24, blockParentMap: new Map() };
    const paginated = paginateLayout(layout, setup);

    // Click past the run width → falls through to "past end of line" path
    const r = paginatedPixelToPosition(paginated, layout, 96 + 25, 136, 816);
    expect(r!.offset).toBe(2);
  });

  it('clicking at x=0 in run returns offset 0', () => {
    const run = mockRun('abc', 0, [8, 16, 24]);
    const line = mockLineWithRuns([run]);
    const block = mockBlock('b1', [line]);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 24, blockParentMap: new Map() };
    const paginated = paginateLayout(layout, setup);

    const r = paginatedPixelToPosition(paginated, layout, 96, 136, 816);
    expect(r!.offset).toBe(0);
  });

  it('handles multi-run lines correctly', () => {
    // "He" (bold, 20px) + "llo" (normal, 15px)
    const run1 = mockRun('He', 0, [12, 20], 0);
    const run2 = mockRun('llo', 20, [5, 10, 15], 2);
    const line = mockLineWithRuns([run1, run2]);
    const block = mockBlock('b1', [line]);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 24, blockParentMap: new Map() };
    const paginated = paginateLayout(layout, setup);

    // Click at x=96+22 → inside run2 at localRunX=2, charOffsets=[5,10,15]
    // Closest to 0 (prev of index 0), so offset = 0 in run2 → global offset 2
    const r = paginatedPixelToPosition(paginated, layout, 96 + 22, 136, 816);
    expect(r!.offset).toBe(2);
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd packages/docs && pnpm vitest run test/view/pagination.test.ts`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/docs/test/view/pagination.test.ts
git commit -m "Add proportional-width hit detection tests for pagination

Test that paginatedPixelToPosition correctly snaps to characters
using pre-computed charOffsets with variable character widths."
```

---

### Task 4: Also fix `getPixelForPosition` to use charOffsets (consistency)

**Files:**
- Modify: `packages/docs/src/view/text-editor.ts:2950-2961`

`getPixelForPosition` currently calls `ctx.measureText(run.text.slice(0, localOff)).width` at runtime. Since charOffsets are now pre-computed, use them for consistency and a small perf win.

- [ ] **Step 1: Replace measureText call with charOffsets lookup**

In `getPixelForPosition`, replace:

```typescript
const isSuperOrSub = run.inline.style.superscript || run.inline.style.subscript;
const measureFontSize = isSuperOrSub
  ? (run.inline.style.fontSize ?? Theme.defaultFontSize) * 0.6
  : run.inline.style.fontSize;
ctx.font = buildFont(measureFontSize, run.inline.style.fontFamily, run.inline.style.bold, run.inline.style.italic);
const x = pageX + pageLine.x + run.x + ctx.measureText(run.text.slice(0, localOff)).width;
```

With:

```typescript
const charX = localOff > 0 ? run.charOffsets[localOff - 1] : 0;
const x = pageX + pageLine.x + run.x + charX;
```

- [ ] **Step 2: Run full test suite**

Run: `cd packages/docs && pnpm vitest run`

Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add packages/docs/src/view/text-editor.ts
git commit -m "Use pre-computed charOffsets in getPixelForPosition

Replace runtime ctx.measureText call with charOffsets lookup for
position-to-pixel mapping, ensuring forward and reverse conversions
use the same data source."
```

---

### Task 5: Verify roundtrip accuracy and update task file

**Files:**
- Modify: `docs/tasks/active/20260325-docs-arrow-pixel-accuracy-todo.md`

- [ ] **Step 1: Run full verify:fast**

Run: `pnpm verify:fast`

Expected: All lint + unit tests pass.

- [ ] **Step 2: Manual verification checklist**

Start the app (`pnpm dev`) and verify:
- [ ] Arrow Up/Down lands on the correct character position
- [ ] Mouse click positions cursor accurately
- [ ] Selection by drag works correctly
- [ ] Table cell text editing still works

- [ ] **Step 3: Update task tracking file**

Mark all items as complete in `20260325-docs-arrow-pixel-accuracy-todo.md`.

- [ ] **Step 4: Final commit**

```bash
git add docs/tasks/active/20260325-docs-arrow-pixel-accuracy-todo.md
git commit -m "Mark arrow pixel accuracy task as complete"
```
