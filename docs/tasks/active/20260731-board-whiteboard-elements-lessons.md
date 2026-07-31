# Board Whiteboard Elements (SP2) — Lessons

Companion to `20260731-board-whiteboard-elements-todo.md`. Design:
`docs/design/board/board-whiteboard-elements.md`.

## Context

SP2 of the board infinite canvas: sticky notes (preset `roundRect` shape),
image paste/drop/file-picker (reused slides upload pipeline), and a view-local
minimap. All board-local; zero slides model change. Built via subagent-driven
development — 6 implementation tasks (each TDD + task-reviewed) + a final
opus whole-branch review. Every task landed Spec ✅ / Approved; final review
"Ready to merge = Yes" with 0 Critical / 0 Important.

Branch commits: sticky factory → sticky toolbar wiring → image `center` param
→ board image wiring → minimap geometry → minimap overlay → chunk-gate bump.

## Lessons

### "Sticky = preset shape" collapsed the whole feature to a factory
Choosing to model a sticky as a `roundRect` `ShapeElement` (fill + drop shadow
+ middle-anchored shrink-autofit text) instead of a new element type meant
**zero slides-model change** and zero renderer/hit-test/PPTX work — a sticky is
just a shape the board toolbar happens to create. All of move/resize/rotate/
snap/collab/undo came for free. The entire "sticky note" feature is one pure
`buildStickyInit()` + a `dropStickyAtViewportCenter()` orchestration; the
toolbar is a color split-button. When a new "element" is really an existing
element with preset styling, resist adding a type.

### The reused image pipeline only needed one additive seam
Image paste/drop/file-picker reused `uploadImageFile`, `insertImageOnSlide`,
and `setupSlidesImagePaths` verbatim. The ONE gap was centering: those helpers
frame against a fixed slide rect, which on an unbounded board lands near world
origin (often off-screen). Fix was an **optional, defaulted `center` param**
threaded through `InsertImageArgs` (a value) and `SlidesImagePathDeps` (a
`() => Point` provider evaluated at drop/paste time so it tracks live pan/zoom)
— slides behavior byte-identical when omitted. Additive optional params are the
right shape for "reuse a slides helper on a board."

### `renderThumbnail`'s `onAssetLoad` is a positional arg, not an options field
The plan's minimap snippet put `onAssetLoad` inside the `SlideRendererOptions`
object. `renderThumbnail(ctx, slide, doc, options, onAssetLoad?)` forwards it
**positionally** to `drawSlide`; `options.onAssetLoad` is only read by the
stateful `SlideRenderer` class, not the one-shot `drawSlide`/`renderThumbnail`
path. Passing it in `options` there is silently dead — async-loaded images
would never retrigger a minimap repaint. The implementer caught this; matches
the existing `thumbnail-panel.ts` precedent. When reusing a render primitive,
check whether a callback is an options field or a trailing positional.

### A `viewport` makes the slide renderer paint transparent (board plane)
`drawSlide`/`renderThumbnail` skip the slide-rect background whenever
`options.viewport` is set (board mode). The minimap exploits this: passing a
fitted viewport paints the scene on a transparent backdrop, so the minimap
element supplies its own CSS background — no special "no background" flag
needed. Reuse of the SP1 viewport seam paid off a second time.

### Imperative overlay factory fits board-view's imperative mount
The minimap is a **vanilla-DOM factory** (`createBoardMinimap`), not a React
component, because board-view builds its canvas/overlay imperatively in one
mount effect and drives repaints from the same pan/zoom/store-change hooks. A
React minimap would have forced viewport state through `setState` every wheel
frame — the exact anti-pattern board-view avoids with a `vp` ref. Keeping the
minimap imperative let it cache the scene snapshot to an offscreen canvas and
`blit + strokeRect` on every viewport change (cheap), re-reading the store only
on scene change (coalesced via rAF). Match the host's rendering paradigm.

### The frontend chunk-COUNT gate is a real merge gate (again)
`verify:self` failed on `verify:frontend:chunks` (144 > 142): board-view
becoming a second importer of the slides frontend image helpers hoisted them
into shared chunks. Legit → bump `maxChunkCount` in `harness.config.json` with
a documented reason prepended to `maxChunkCountReason` (the repo's established
pattern; same as SP1's 135→140→142). Not a code problem. The new board-only
modules (sticky/board-image/board-minimap/minimap-geometry) folded into the
existing `board-view-*.js` route chunk — same route, no new chunk.

### SDD process notes
- Model tiering: sonnet implementers + sonnet task reviewers throughout (each
  task had complete code in the brief or was mechanical integration); opus only
  for the final whole-branch review — which is exactly where the cross-cutting
  reachability/lifecycle verification mattered. All 6 tasks passed first review;
  no fix loops triggered.
- Two implementer deviations were *improvements* the reviews confirmed sound:
  a `toast.error` on toolbar-image-upload failure (matching the paste/drop
  path, no double-toast), and the `onAssetLoad` positional fix above. Good
  implementers improve the brief where it's wrong; the review is the check.
- The whole-branch review caught nothing the per-task reviews missed *as
  defects*, but it was the only pass that could verify the SP1 reachability
  lesson (no reused-editor gesture hits `notSupported()`) and that all three
  features tear down cleanly in the shared mount effect — confirmation the
  per-task scope structurally cannot give.

## Verification notes

- `pnpm verify:self`: all lanes green after the chunk bump (frontend build +
  144-chunk gate + backend/cli build + entropy). `verify:fast` green on every
  commit via the pre-commit hook.
- New tests: `sticky` (5), `insert-image` center override (2), `board-image`
  adapter (1), `minimap-geometry` (6 describes), `board-minimap` factory smoke
  (2). Frontend suite grew 886 → 902 passing. Slides suite unchanged (2629),
  confirming the additive `center` param left slides untouched.
- Final whole-branch review (opus): Ready to merge = Yes, 0 Critical / 0
  Important; surviving Minors are documented follow-ups.

## Deferred to a later cleanup PR (non-blocking)

- Consolidate the duplicate-basename `packages/frontend/src/app/slides/insert-image.test.ts`
  into the pre-existing `packages/frontend/tests/app/slides/insert-image.test.ts`
  (reuse `MemSlidesStore` instead of the hand-rolled fake); the fallback case is
  self-referential vs `computeImageFrame`.
- Drop the redundant `as ElementInit` cast in `sticky.ts`.
- Sticky auto-text-edit works (`enterTextEditing`); the Image toolbar control is
  a `Toggle(pressed=false)` (momentary) vs the sticky's `Button` — cosmetic.

## Deferred to future SP2+ work

- Peer-cursor dot rendering (still deferred from SP1). Minimap does not show
  peer viewports. Sticky recolor UI (the palette wires insert only). Sticky
  templates / connector auto-attach. Image crop entry from board. Zoom-to-fit-all
  button. Spatial index for `store.read()` O(n) on large boards.
