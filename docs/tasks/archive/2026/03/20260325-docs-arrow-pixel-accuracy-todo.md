# Docs: Arrow Up/Down pixel-to-position accuracy

**Created**: 2026-03-25
**Status**: TODO

## Problem

When pressing Arrow Up/Down to move between lines, the cursor lands one character off.
For example, `he|llo world` on line 2 → Arrow Up → `hel|lo world` on line 1.

### Root Cause

`paginatedPixelToPosition` (pagination.ts:266) uses **uniform character width** to reverse-map
pixel x → character offset:

```typescript
const charWidth = run.width / Math.max(1, run.text.length);
const charOffset = Math.round(localRunX / charWidth);
```

But `getPixelForPosition` uses `ctx.measureText()` for the forward mapping (position → pixel),
creating an asymmetry. Proportional fonts have variable character widths, so the uniform
approximation lands on the wrong character.

## Proposed Fix

Two approaches analyzed — recommend **Option 2** for long-term quality:

### Option 1: Pass `ctx` to `paginatedPixelToPosition` (quick fix)
- Add `CanvasRenderingContext2D` parameter, use `measureText` in the hit-test loop
- Pro: small diff. Con: breaks pure-function testability of pagination.ts

### Option 2: Pre-compute `charOffsets` in layout (recommended)
- Add `charOffsets: number[]` to `LayoutRun` during layout build
- `paginatedPixelToPosition` uses binary search on pre-computed offsets
- Pro: stays pure, reusable for selection rendering, better perf on repeated hit-tests
- Con: wider change across layout pipeline

## Tasks

- [x] Choose approach and implement
- [x] Update pagination.test.ts with proportional-width test cases
- [x] Verify Arrow Up/Down lands on correct character
- [x] Verify mouse click positioning is also improved
