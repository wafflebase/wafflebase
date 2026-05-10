# Slides snap guides + align/distribute toolbar

**Goal:** Make the existing slides snap engine visible (live alignment
guides drawn during drag) and add a multi-select align/distribute toolbar
group. Brings slides closer to Google Slides parity for object-arrangement
ergonomics.

**Scope:** `packages/slides` (snap return shape, overlay guide rendering,
align/distribute pure functions, editor wiring) + `packages/frontend`
(toolbar group). No data-model or theme changes. No grid system.

## Background

- Snap math already exists at `packages/slides/src/view/editor/snap.ts`
  (8 px threshold, snaps dragged group's edges/center to slide-center
  and to non-selected element edges/centers, X and Y independent).
- It's invoked on every mousemove in
  `packages/slides/src/view/editor/editor.ts:739` but only its `{dx, dy}`
  is used — the *which candidate won* information is discarded, so no
  guide line can be drawn.
- Overlay layer (`view/editor/overlay.ts`) currently draws only selection
  frame + 8 resize handles + rotate handle. Has room for guide lines.
- `slides-formatting-toolbar.tsx` is the toolbar React component; it
  has no alignment controls today.
- `slides.md:378` already lists "snap guidelines while dragging" as a
  planned overlay feature; `slides.md:70-71` defers align/distribute to
  v1.1. This task delivers both.

## Decisions

- **Guide rendering surface:** overlay DOM layer (not canvas).
  Cheaper to update; never leaks into PDF/thumbnail render path.
- **Guide line span (v1):** full slide width for horizontal guides /
  full slide height for vertical guides. Simpler than the
  Figma-style "extend only between aligned elements", visually clear.
  Can tighten later if noisy.
- **Guide style:** 1 px solid magenta `#e11d48` (distinct from selection
  green `#3a7`). Matches common "snap" convention.
- **Snap return shape:** change `snapDelta()` to
  `{ dx, dy, guides: SnapGuide[] }`. Single caller; no compatibility
  concern.
- **Align semantics:**
  - Multi-select (≥ 2): align relative to the combined bounding box of
    the selected elements (so "align left" pulls all to the leftmost
    edge of the selection). This is what Google Slides / PowerPoint do.
  - Single select (= 1): align relative to the **slide canvas**
    (1920 × 1080). "Center this element on the slide" is a common
    single-select use case.
- **Distribute semantics:** require ≥ 3 elements; equal spacing
  between leftmost and rightmost (or topmost/bottommost). The endpoints
  stay; only inner elements move. Same convention as Google Slides.
- **Rotated elements:** use the stored axis-aligned `frame` (not the
  rotated bounding box). Matches Google Slides and avoids divergent
  behavior for already-snapped layouts.
- **Toolbar location:** new section in
  `slides-formatting-toolbar.tsx`, between the existing shape/insert
  cluster and the theme controls. Buttons disabled by selection size:
  align ≥ 1, distribute ≥ 3.
- **Editor surface:** add `align(direction)` and `distribute(axis)` to
  the `SlidesEditor` interface. Toolbar calls these (parallels how it
  already uses the editor for insert mode), so the commit path stays
  unified (one `store.batch()`, one `markDirty()`, one `render()`).

## File map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/slides/src/view/editor/snap.ts` | Modify | Return `{dx, dy, guides}`; export `SnapGuide` type |
| `packages/slides/src/view/editor/snap.test.ts` | Modify | Cover guide emission for slide-center + element-edge snaps |
| `packages/slides/src/view/editor/overlay.ts` | Modify | Render guide lines from `OverlayOptions.guides` |
| `packages/slides/src/view/editor/overlay.test.ts` | Modify (or create) | Assert guide nodes appear when guides are passed |
| `packages/slides/src/view/editor/editor.ts` | Modify | Plumb guides through `paintLive`; expose `align()` + `distribute()`; clear guides on mouseup |
| `packages/slides/src/view/editor/align.ts` | Create | Pure functions: `alignFrames(frames, dir, ref)`, `distributeFrames(frames, axis)` |
| `packages/slides/src/view/editor/align.test.ts` | Create | Unit tests for align (multi+single, all 6 dirs) and distribute (h/v) |
| `packages/slides/src/index.ts` | Modify | Re-export `AlignDirection`, `DistributeAxis` types |
| `packages/frontend/src/app/slides/slides-formatting-toolbar.tsx` | Modify | New ToolbarGroup with 6 align + 2 distribute buttons; disabled state from selection size |
| `docs/design/slides/slides.md` | Modify | Move snap guides + align/distribute from "future" to "shipped"; brief sub-section under editor |

## Plan

### Phase 1 — Snap guide data model

- [ ] **1.1** Add to `snap.ts` the `SnapGuide` type:

  ```ts
  export type SnapGuide =
    | { axis: 'x'; position: number; kind: 'slide-center' | 'edge' }
    | { axis: 'y'; position: number; kind: 'slide-center' | 'edge' };
  ```

  Update `snapDelta` return type to
  `{ dx: number; dy: number; guides: SnapGuide[] }`.
  Inside `bestSnapAdjust`, also remember which candidate won so the
  caller can map it to a guide. Refactor `bestSnapAdjust` to return
  `{ adjust: number; winnerIndex: number | null }`. Build the
  `guides` list by inspecting the winning candidates on each axis
  (slide-center if index 0, edge otherwise). `position` is the snap
  line's slide-space coordinate (= the `to` of the winning candidate).
- [ ] **1.2** Update `snap.test.ts`. Existing assertions become
  `result.dx`/`result.dy`. Add 3 new tests:
  - slide-center snap on X emits one guide `{axis:'x', position:960, kind:'slide-center'}`
  - element-edge snap emits `{axis:'x', position:600, kind:'edge'}`
  - no snap → `guides: []`
- [ ] **1.3** Run `pnpm --filter @wafflebase/slides test snap`. All
  assertions green.
- [ ] **1.4** Commit: `feat(slides): emit snap guide info from snapDelta`.

### Phase 2 — Overlay guide rendering

- [ ] **2.1** Extend `OverlayOptions` in `overlay.ts`:

  ```ts
  export interface OverlayOptions {
    scale: number;
    guides?: readonly SnapGuide[];
    slideWidth: number;
    slideHeight: number;
  }
  ```

  After the existing handle loop, render one absolutely-positioned
  `<div class="wfb-slides-snap-guide">` per guide:
  - vertical (`axis: 'x'`): `left = position * scale`, `top = 0`,
    `width = 1px`, `height = slideHeight * scale`
  - horizontal (`axis: 'y'`): `left = 0`, `top = position * scale`,
    `width = slideWidth * scale`, `height = 1px`
  - background `#e11d48`, `pointer-events: none`.
- [ ] **2.2** Update all `renderOverlay` call sites to pass
  `slideWidth`/`slideHeight` from `SLIDE_WIDTH`/`SLIDE_HEIGHT`.
  In `editor.ts` `paintLive` (line 780) accept a `guides` arg and
  forward; in the no-drag overlay refresh path pass `guides: []`.
- [ ] **2.3** Add an overlay test (or create
  `view/editor/overlay.test.ts` if it doesn't exist) asserting:
  - no guide nodes when `guides: []`
  - one vertical line at `left: 480px` when called with
    `guides: [{axis:'x', position:960, kind:'slide-center'}]` and
    `scale: 0.5`
- [ ] **2.4** Run `pnpm --filter @wafflebase/slides test overlay`. Green.
- [ ] **2.5** Commit: `feat(slides): render snap guides on overlay`.

### Phase 3 — Wire guides through drag interaction

- [ ] **3.1** In `editor.ts` `startDrag` (line 716):
  - Capture `guides` from `snapDelta` result on each `onMove`.
  - Pass them into `paintLive(live, guides)`.
  - On `onUp`, render the post-commit overlay with `guides: []` so
    the lines disappear once the drag ends.
- [ ] **3.2** Manual smoke test in `pnpm dev`: drag an element until
  its center crosses slide-center → magenta vertical line appears;
  drag near another element's edge → guide appears; release → guide
  vanishes.
- [ ] **3.3** Run `pnpm --filter @wafflebase/slides test`. Green.
- [ ] **3.4** Commit: `feat(slides): show alignment guides while dragging`.

### Phase 4 — Align/distribute pure functions

- [ ] **4.1** Create `align.ts`:

  ```ts
  import type { Frame } from '../../model/element';

  export type AlignDirection =
    | 'left' | 'center-h' | 'right'
    | 'top'  | 'center-v' | 'bottom';
  export type DistributeAxis = 'horizontal' | 'vertical';

  export interface AlignReference { x: number; y: number; w: number; h: number; }

  /** Returns a map id→new frame for elements that need to move. */
  export function alignFrames(
    frames: ReadonlyMap<string, Frame>,
    direction: AlignDirection,
    reference: AlignReference,
  ): Map<string, Frame> { /* ... */ }

  /** Distributes inner elements; endpoints stay. Returns id→new frame. */
  export function distributeFrames(
    frames: ReadonlyMap<string, Frame>,
    axis: DistributeAxis,
  ): Map<string, Frame> { /* ... */ }
  ```

  Implementation rules:
  - `alignFrames`: per direction, compute target edge/center from
    `reference`, set `x` (or `y`) on each frame so the relevant edge
    of the frame matches. Skip frames that already match (don't emit
    a no-op entry — keeps the batch tight).
  - `distributeFrames`: require ≥ 3; sort by leading edge (x or y);
    keep the first and last; gap = (lastEdge − firstEdge − sum(inner widths))/(n−1); place inner elements consecutively. Return only frames that moved.
- [ ] **4.2** Create `align.test.ts` with cases:
  - 3 elements, align left, ref = bbox of selection → all `x` = min(x)
  - 1 element, align center-h, ref = `{x:0,y:0,w:1920,h:1080}` →
    `x = (1920 − w) / 2`
  - all 6 directions on a 2-element selection
  - distribute horizontal, 3 elements with non-uniform widths → middle
    moves so gaps between consecutive bboxes are equal
  - distribute requires ≥ 3 — call with 2 elements throws or returns
    empty map (decide: empty map; matches "no-op for impossible input"
    convention used elsewhere in the package)
- [ ] **4.3** Run `pnpm --filter @wafflebase/slides test align`. Green.
- [ ] **4.4** Commit: `feat(slides): align + distribute frame helpers`.

### Phase 5 — Editor exposure

- [ ] **5.1** Add to `SlidesEditor` interface in `editor.ts`:

  ```ts
  align(direction: AlignDirection): void;
  distribute(axis: DistributeAxis): void;
  ```

  Implementation in `SlidesEditorImpl`:
  - Read current slide + selected element ids; collect their frames.
  - For align: reference = `combinedBoundingBox(selectedFrames)` if ≥ 2,
    else `{x:0, y:0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT}`.
  - Call `alignFrames` / `distributeFrames`.
  - Wrap the resulting updates in `store.batch()`, calling
    `updateElementFrame(slideId, id, frame)` per moved element.
  - `markDirty()` + `render()`.
  - No-op when selection is empty (align) or < 3 (distribute).
- [ ] **5.2** Re-export `AlignDirection`, `DistributeAxis` from
  `packages/slides/src/index.ts`.
- [ ] **5.3** Add an editor-level test (extend `editor.test.ts` or
  create `editor.align.test.ts`) covering:
  - align left with multi-select moves frames to bbox.x
  - align center-h with single-select centers on slide
  - distribute horizontal with 3 elements equalizes gaps
  - distribute with 2 elements is a no-op
- [ ] **5.4** Run `pnpm --filter @wafflebase/slides test`. Green.
- [ ] **5.5** Commit: `feat(slides): editor align + distribute API`.

### Phase 6 — Toolbar UI

- [ ] **6.1** In `slides-formatting-toolbar.tsx`, add a new toolbar
  group with 8 buttons. Use tabler icons:
  `IconLayoutAlignLeft`, `IconLayoutAlignCenter`, `IconLayoutAlignRight`,
  `IconLayoutAlignTop`, `IconLayoutAlignMiddle`, `IconLayoutAlignBottom`,
  `IconLayoutDistributeHorizontal`, `IconLayoutDistributeVertical`.
  Each calls `editor?.align(...)` / `editor?.distribute(...)`.
- [ ] **6.2** Disabled state derived from `editor.getSelection().length`
  via the existing `onSelectionChange` subscription pattern already
  used in this file:
  - align buttons: disabled when length === 0
  - distribute buttons: disabled when length < 3
  Keep tooltip text descriptive (e.g., "Align left", "Distribute
  horizontally — needs 3+ objects").
- [ ] **6.3** Manual smoke in `pnpm dev`:
  - select 1 element → click "align center-h" → element snaps to slide
    center horizontally
  - select 3 elements → click "distribute horizontal" → equal gaps
  - select 0 → align/distribute buttons greyed out
- [ ] **6.4** Run `pnpm verify:fast`. Green.
- [ ] **6.5** Commit: `feat(slides): align/distribute toolbar group`.

### Phase 7 — Docs + wrap-up

- [ ] **7.1** Update `docs/design/slides/slides.md`:
  - Move "snap guidelines while dragging" out of "future" into the
    editor/rendering section describing what's shipped.
  - Replace the v1.1-deferred align/distribute bullet with a
    short shipped sub-section listing semantics (multi-select uses
    selection bbox, single-select uses slide, distribute needs 3+).
- [ ] **7.2** Self-review: dispatch
  `superpowers:requesting-code-review` over the branch diff. Address
  blocking findings; note non-blocking ones in a follow-up bullet here.
- [ ] **7.3** `pnpm verify:fast` final pass.
- [ ] **7.4** `pnpm tasks:archive && pnpm tasks:index`.
- [ ] **7.5** Open PR. Title: `Slides: live snap guides + align/distribute toolbar`.

## Verification

- `pnpm --filter @wafflebase/slides test` green (unit: snap, overlay,
  align, editor).
- `pnpm verify:fast` green.
- Manual smoke: drag → see guides; align/distribute buttons behave
  per the spec above; rotated element aligns by its axis-aligned frame.

## Notes

- Guide span (full slide vs between elements) is the most likely
  follow-up tweak. Keeping v1 as full-slide spans simplifies the
  data flow and matches a common style; switch to bounded spans only
  if visual clutter is reported.
- Snap threshold stays at 8 logical px — out of scope here.
- Group support, locked elements, snap-to-grid, snap-to-layout
  placeholders: explicitly deferred. The `SnapGuide` type leaves
  `kind` open for later additions.
- No backend / Yorkie schema changes — align/distribute reuse the
  existing `updateElementFrame` op inside one `store.batch()`.
