# Slides: Keep text readable when shape/text is flipped

**Goal:** Match PowerPoint / Google Slides behavior — when a shape (or text element, or a flipped ancestor group) has `flipH` / `flipV` set, the shape geometry mirrors but inline / standalone text remains readable.

**Context:** User reported the right-side diagram on slide 26 of [this deck](https://wafflebase.io/shared/03059175-bd2a-43cf-8f7a-714e3d5d63aa) shows mirror-flipped text inside flipped shapes. PowerPoint and Google Slides keep text upright (readable) for flipped shapes — only the geometry/path mirrors. Our renderer currently applies `ctx.scale(-1, 1)` to the whole element transform, which flips text glyphs along with the path.

**Architecture:** Single fix point at `packages/slides/src/view/canvas/element-renderer.ts`. The base element transform keeps applying flip (so groups still mirror children's positions, hit-test inversion in `element-hit.ts` stays valid, and connection sites in `connection-sites/index.ts` keep current semantics). What changes: text painting (inline shape text + standalone text element) is wrapped in a centered counter-flip that cancels the accumulated flip just for text glyphs. Accumulated flip is threaded through `drawElement` recursion as XOR of ancestor + own flips so a text leaf inside a flipped group also un-flips correctly.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `packages/slides/src/view/canvas/element-renderer.ts` | Thread accumulated flip through recursion; wrap text painting in counter-flip | Modify |
| `packages/slides/src/view/canvas/shape-renderer.ts` | Stop calling `paintShapeText` internally — caller orchestrates with counter-flip wrap; export `paintShapeText` | Modify |
| `packages/slides/test/view/canvas/element-renderer.test.ts` | Add tests: flipped shape with inline text counter-flips, flipped text element counter-flips, child of flipped group counter-flips | Modify |

---

## Tasks

- [x] **Task 1:** Refactor `shape-renderer.ts` — split `paintShapeText` out so `drawShape` only paints geometry.
  - Export `paintShapeText`.
  - Remove the three internal call sites (`drawShape` after path, `drawPlaceholderRect` after rect, action-button branch).
  - Action-button branch returns after `drawActionButton`; caller paints text.

- [x] **Task 2:** Update `element-renderer.ts` to track accumulated flip + wrap text painting.
  - Add `parentFlip = { h: false, v: false }` param to `drawElement`.
  - Compute `totalFlip = { h: parent.h XOR own.h, v: parent.v XOR own.v }`.
  - Recurse into group children with `totalFlip` as their `parentFlip`.
  - After `drawShape`, call `paintShapeText` inside a counter-flip wrapper keyed off `totalFlip`.
  - Wrap `drawText` dispatch in the same counter-flip wrapper.
  - `drawImage` continues to paint under the flipped transform (image flipping is desired).

- [x] **Task 3:** Add unit tests covering the new behavior.
  - Test: flipped shape with inline text → second pair of `translate/scale` around centre cancels the flip before text paint.
  - Test: flipped standalone text element → counter-flip applied.
  - Test: text element inside a `flipH` group → counter-flip uses the accumulated flip.
  - Test: non-flipped shape with text → no extra counter-flip applied (regression guard).
  - Updated `shape-renderer-text.test.ts` to call `paintShapeText` directly (drawShape no longer paints text).

- [x] **Task 4:** Verify
  - `pnpm verify:fast` green (all 56 docs, 239 slides, 17 sheets, 59 frontend, 49 backend test files pass).
  - Manual smoke on `pnpm dev` is pending — user will validate against slide 26 of the shared deck.

---

## Notes

- **Hit test (`element-hit.ts:108-109`) stays as is.** It inverts flipH/V to test against the un-flipped local Path2D — that geometry is still painted flipped, so the inversion remains correct.
- **Connection sites (`connection-sites/index.ts:31-42`) stay as is.** Sites resolve against the still-flipped path geometry.
- **In-place text edit overlay (`text-box-editor.ts:212-215`) was already not applying flip.** Before this fix there was a visible "snap" between edit (readable) and committed (mirrored). After this fix the two match.
- **PPTX import (`pptx/geometry.ts`) untouched.** `<a:xfrm flipH>` continues to set the model field; the change is purely paint-time.
