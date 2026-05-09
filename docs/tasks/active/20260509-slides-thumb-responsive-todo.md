# Slides — responsive thumbnails + DPR fix

## Problem

Two complaints about the slides left sidebar:

1. **Thumbnails don't fit panel width.** The left panel is drag-resizable
   (`slides-view.tsx:136`, 120–480px), but each thumbnail is hardcoded to
   `192×108px` (`thumbnail-panel.ts:6-7`). Narrow panel → horizontal
   overflow. Wide panel → wasted whitespace.
2. **Thumbnails look blurry on Retina.** `thumbnail-panel.ts:59-68`
   sizes the canvas backing store at logical pixels and passes
   `dpr: 1`, while the main slide canvas (`slides-view.tsx:112,205-206`)
   correctly multiplies by `window.devicePixelRatio`. Result: thumbnails
   render at half resolution on 2× displays.

## Plan

- [ ] Apply DPR to thumbnail canvas: backing store sized at
      `THUMB_W * dpr × THUMB_H * dpr`, CSS at logical px, pass real
      `dpr` to `renderThumbnail`.
- [ ] Make thumbnail size derive from the host element's measured
      width (minus scrollbar/padding gutter), preserving 16:9.
      Re-render on container resize via `ResizeObserver`.
- [ ] Keep the panel's drag-resize behavior (`slides-view.tsx`)
      untouched — only the thumbnail sizing inside the panel changes.
- [ ] Adjust `thumbnail-panel.test.ts` if assumptions about fixed
      width break; add minimal coverage for DPR + responsive sizing.
- [ ] `pnpm verify:fast` green.
- [ ] Browser smoke in `pnpm dev`: drag handle to narrow/wide,
      confirm thumbnails scale and stay crisp on Retina.

## Files touched

- `packages/slides/src/view/editor/thumbnail-panel.ts` — main change
- `packages/slides/src/view/editor/thumbnail-panel.test.ts` — coverage

## Out of scope

- Removing the drag-resize handle / making panel auto-fit content.
- Main canvas DPR (already correct).
- Notes panel sizing.

## Review

(populated after implementation)
