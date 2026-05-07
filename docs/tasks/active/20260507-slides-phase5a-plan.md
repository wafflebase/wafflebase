# Slides Phase 5a (Text Editing + CJK Fonts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Land in-place text editing for text elements + speaker
notes, with proper Korean / CJK font fallback. Closes the biggest
remaining gap between Phase 4 ("editor works but you can't type") and
a usable v1. Image input, presentation mode, and PDF export are
Phase 5b; CLI is Phase 5c.

**Architecture:**
- Per the docs RichText audit
  (`packages/slides/spike/docs-richtext-audit.md`), the docs `Doc`,
  `computeLayout`, `Cursor`, `Selection`, and `TextEditor` model is
  reusable for slides text-boxes. The renderer (`DocCanvas.render`)
  and entry point (`initialize`) are shaped around paginated full-page
  documents and need a sibling `initializeTextBox` factory plus a
  page-free `paintLayout` helper.
- T1-T3 perform the docs-side refactor: pure extraction, no behaviour
  change to the existing docs editor. Verified by `pnpm docs test`
  and by the docs editor continuing to work in the demo.
- T4 wires slides' double-click-to-edit interaction to the new
  `initializeTextBox` factory, mounting it inside the existing
  selection overlay.
- T5 migrates text element bodies (and speaker notes) from
  `Block[]` JSON inside the Yorkie root to `Yorkie.Tree`, so concurrent
  text edits converge character-by-character instead of last-write-wins
  on the whole `blocks` array.
- T6 wires CJK font fallback for the slide text renderer (slides
  reuses the docs font registry directly).

**Spec:** [`docs/design/slides/slides.md`](../../design/slides/slides.md)
"Yorkie schema > Text" + "Rendering pipeline > Korean / CJK font
fallback". Plan delivers todo items 5.1, 5.2, 5.4. Items 5.3, 5.5–5.10
are Phases 5b/5c.

> Phase 5a ends when items 5.1, 5.2, 5.4 are ticked, `pnpm verify:fast`
> is green, and you can: (a) double-click a text element on the canvas
> to enter edit mode, (b) type Korean / CJK / Latin freely with IME
> composition working, (c) blur or press Escape to commit, (d) see the
> commit converge across two browser windows via Yorkie.

---

## File structure

Created in this phase:

```
packages/docs/src/view/
├── paint-layout.ts                              # T1 (extracted from doc-canvas.ts)
├── find-position-at-pixel.ts                    # T2 (extracted from pagination.ts)
└── text-box-editor.ts                           # T3 (initializeTextBox factory)

packages/slides/src/view/editor/
├── text-box-editor.ts                           # T4 (slides wiring)
└── text-box-editor.test.ts                      # T4

packages/slides/src/view/canvas/
└── fonts.ts                                     # T6 (CJK fallback registration)
```

Modified in this phase:

- `packages/docs/src/view/doc-canvas.ts` — `render()` becomes a thin
  wrapper around `paintLayout`, calling it once per page (T1)
- `packages/docs/src/view/pagination.ts` — `paginatedPixelToPosition`
  becomes a thin wrapper around `findPositionAtPixel` (T2)
- `packages/docs/src/view/text-editor.ts` — split out `setCanvasCursor`
  hard-coding into a per-instance attribute (T3)
- `packages/docs/src/index.ts` — re-export `TextEditor`,
  `initializeTextBox`, `paintLayout`, `findPositionAtPixel` (T3)
- `packages/slides/src/view/canvas/text-renderer.ts` — replace the
  inline drawText call sequence with `paintLayout` from docs (T6
  + T1 dependency)
- `packages/slides/src/view/editor/editor.ts` — wire double-click on
  text element → mount text-box-editor (T4)
- `packages/frontend/src/types/slides-document.ts` — `TextElement.data`
  and `Slide.notes` typed as `Tree` instead of `Block[]` (T5)
- `packages/frontend/src/app/slides/yorkie-slides-store.ts` — Tree
  initialisation in `ensureSlidesRoot` for text bodies and notes;
  `withTextElement` / `withNotes` hand back the live `Tree` (T5)

---

## Conventions

Same as prior phases. Frontend tests use `node:test`; docs and slides
packages use vitest. No `--no-verify`. Branch `feat/slides-phase1`.

The docs refactor tasks (T1-T3) MUST NOT change docs editor behaviour.
The acceptance criterion is: every existing docs test continues to
pass, and the docs editor in the demo (`pnpm --filter @wafflebase/docs
dev`) continues to work identically. Reviewers: verify by reading
the diff that the existing entry points are now thin wrappers around
the new helpers.

---

## Task 1: Extract paintLayout from DocCanvas

**Goal:** Create a public `paintLayout(ctx, layout, originX, originY,
opts)` helper that walks `layout.blocks[].lines[].runs[]` and emits
the same paint calls the current `DocCanvas.render` makes per page,
WITHOUT page chrome (no page background, no shadow, no page numbers,
no headers / footers, no page breaks). Then refactor
`DocCanvas.render` to call it once per page.

**Files:**
- Create: `packages/docs/src/view/paint-layout.ts`
- Modify: `packages/docs/src/view/doc-canvas.ts` (render becomes a
  wrapper)

**Approach:**
- Read `DocCanvas.render` (`packages/docs/src/view/doc-canvas.ts:103-810`)
  and identify the per-line paint loop (`renderRun` + ancestors). This
  is the body that goes into `paintLayout`.
- Per-page chrome (background, shadow, page number, header/footer)
  stays in `DocCanvas.render`.
- The slim `paintLayout` signature:
  ```ts
  export interface PaintLayoutOpts {
    theme: Theme;
    cursor?: { x: number; y: number; height: number; visible: boolean };
    selectionRects?: Array<{ x: number; y: number; width: number; height: number }>;
  }

  export function paintLayout(
    ctx: CanvasRenderingContext2D,
    layout: DocumentLayout,
    originX: number,
    originY: number,
    opts: PaintLayoutOpts,
  ): void;
  ```
  `originX` / `originY` are the world-coords origin where
  `layout.blocks[0]` should land. `cursor` and `selectionRects` are
  in layout-local coords (caller pre-translates if needed).

- [x] **Step 1.1: Read `doc-canvas.ts:render()` and identify the
  per-line paint body**

  Skim with `git blame` if it helps to spot any non-obvious
  invariants. Note any state setup at the top of `render` that the
  per-line loop depends on (font cache, scale, etc.).

- [x] **Step 1.2: Write the extracted helper**

  Create `packages/docs/src/view/paint-layout.ts`. Move
  `renderRun` (and its private helpers) into it. Keep all
  invariants (sub/sup baseline, RTL, list markers, image inlines,
  hyperlink underline) intact — copy verbatim where possible.

- [x] **Step 1.3: Re-wire `DocCanvas.render` to call `paintLayout`
  per page**

  The page-chrome painting stays. After painting per-page chrome,
  call `paintLayout(ctx, pageLayout, pageOriginX, pageOriginY, opts)`
  with the per-page slice of the document layout.

  Implementation note: rather than slicing the layout into per-page
  `DocumentLayout` objects, T1 extracts the run-painting helpers
  (`renderRun`, `renderListMarker`, `drawInlineRunBackgroundsForPage`)
  into module-level functions in `paint-layout.ts`, and DocCanvas's
  per-page-line loop calls them directly. `paintLayout` is the
  block-walking sibling slides will consume in T4 — both share the
  same `renderRun` so behaviour stays single-sourced. Tables and
  horizontal rules / page breaks remain in DocCanvas (they're page-
  aware via `PageLine`); slides text-boxes don't host them in v1.

- [x] **Step 1.4: Verify**

  Run: `pnpm --filter @wafflebase/docs test`
  Run: `pnpm --filter @wafflebase/docs build`
  Expected: green. No new tests for `paintLayout` in T1 — its
  behaviour is verified end-to-end by every existing docs render
  test.

  All 741 docs tests pass; typecheck, build, and `pnpm verify:fast`
  all green.

- [x] **Step 1.5: Commit**

```bash
git commit -m "Extract paintLayout helper from DocCanvas" -m "Pure extraction. The per-line / per-run paint body of
DocCanvas.render moves into a new paint-layout.ts that takes a
DocumentLayout + (originX, originY) and writes to the supplied ctx
without any page chrome (page background, shadows, page numbers,
header/footer). DocCanvas.render keeps the per-page chrome and
calls paintLayout once per page slice.

No behaviour change for the docs editor. Phase 5a slides text-box
editor (T4) consumes paintLayout to render rich text inside a
slide text frame without going through paginateLayout.

Refs packages/slides/spike/docs-richtext-audit.md 'Paint pipeline'."
```

---

## Task 2: Extract findPositionAtPixel from paginatedPixelToPosition

**Goal:** Create a public `findPositionAtPixel(layout, x, y):
DocPosition | null` that hit-tests a `(x, y)` against a
`DocumentLayout` and returns the `(blockId, offset)` under it.
Refactor `paginatedPixelToPosition` to call it.

**Files:**
- Create: `packages/docs/src/view/find-position-at-pixel.ts`
- Modify: `packages/docs/src/view/pagination.ts`

**Approach:**
- `paginatedPixelToPosition` translates from page-local pixel coords
  to a `DocPosition`. It does this by finding the page, then a line
  within the page, then a run within the line, then a character
  within the run.
- The page-finding step is page-shaped. The line/run/char steps are
  layout-shaped and can run on any `DocumentLayout`.
- Extract the layout-shaped portion into `findPositionAtPixel`. The
  page-shaped wrapper passes a single page's layout into it.

- [x] **Step 2.1: Read `pagination.ts:paginatedPixelToPosition` (and
  its helpers)**

  Identify the layout-shaped vs page-shaped portions.

  Page-shaped: page-finding (gap snapping, last-page clamping), per-
  page `targetPL` selection (uses `pl.rowSplitHeight` for table-row
  splits). Layout-shaped: empty-line short-circuit, line-relative
  before/inside/past-end run hit-test, char binary search on
  `run.charOffsets`, trailing-space trim for wrapped lines, affinity
  computation at line boundaries.

- [x] **Step 2.2: Write the extracted helper**

  Created `packages/docs/src/view/find-position-at-pixel.ts`. The
  helper returns a `PixelPosition` (the same `{ blockId, offset,
  lineAffinity }` triple the wrapper returns) so the wrapper stays
  truly thin. Affinity is hit-test-derived and can't be reconstructed
  from the bare `DocPosition`, so it lives on the result type rather
  than on the model.

  Strict semantics: returns `null` when `(x, y)` is outside every
  block (above blocks[0], below the last block, or empty layout) so
  slides text-boxes can decide what to do with off-content clicks.
  The paginated wrapper supplies its own clamping so the existing
  docs editor behaviour is preserved.

- [x] **Step 2.3: Re-wire `paginatedPixelToPosition`**

  Page-finding and per-page line-finding (with row-split awareness)
  stay in `pagination.ts`. After the wrapper picks a `targetPL`, it
  translates page-local pixels to layout-local: `layoutX = localX`
  (body blocks have `lb.x === 0`); `layoutY = lb.y + line.y +
  line.height/2` — guaranteed to land inside the chosen line so the
  helper re-finds the same line even when `localY` was beyond the
  visible height (the wrapper's "past last line on page" fallback).
  A defensive fallback returns `{ blockId, offset: 0 }` if the helper
  unexpectedly returns null (e.g., zero-height line).

- [x] **Step 2.4: Verify**

  - `pnpm --filter @wafflebase/docs typecheck` — clean
  - `pnpm --filter @wafflebase/docs test` — 741/741 green
  - `pnpm verify:fast` — green (architecture, frontend, backend,
    sheets, slides, cli, docs lanes all pass)

- [x] **Step 2.5: Commit**

```bash
git commit -m "Extract findPositionAtPixel from paginatedPixelToPosition" -m "Pure extraction. The layout-shaped portion of
paginatedPixelToPosition (find line, find run, find char) moves
into a new find-position-at-pixel.ts that operates on any
DocumentLayout in layout-local coordinates. The paginated wrapper
keeps the page-finding step and translates page-local pixels into
layout-local before delegating.

No behaviour change for the docs editor. Phase 5a slides text-box
editor consumes findPositionAtPixel for cursor / selection
hit-testing inside a single text-box.

Refs packages/slides/spike/docs-richtext-audit.md 'Selection / cursor'
and 'Required exports'."
```

---

## Task 3: initializeTextBox + re-exports

**Goal:** Add a slim `initializeTextBox(opts): TextBoxEditorAPI`
factory that's the slides-friendly sibling of `initialize` (the
full-document factory). Re-export `TextEditor`, `paintLayout`,
`findPositionAtPixel`, `initializeTextBox` from
`packages/docs/src/index.ts`.

**Files:**
- Create: `packages/docs/src/view/text-box-editor.ts`
- Modify: `packages/docs/src/view/text-editor.ts` (per-instance
  cursor target)
- Modify: `packages/docs/src/index.ts` (re-exports)

**Approach:**
- `initializeTextBox` factory takes:
  ```ts
  export interface TextBoxEditorOptions {
    container: HTMLElement;          // overlay container slides supplies
    canvas: HTMLCanvasElement;       // a per-textbox canvas slides supplies
    blocks: Block[];                 // initial content (slides hands the live array via withTextElement)
    contentWidth: number;            // logical pixels (frame.w - padding)
    contentHeight: number;           // logical pixels (frame.h - padding)
    onCommit?: (blocks: Block[]) => void;  // called on blur / Escape
    onCancel?: () => void;
  }

  export interface TextBoxEditorAPI {
    focus(): void;
    blur(): void;
    detach(): void;
  }

  export function initializeTextBox(
    opts: TextBoxEditorOptions,
  ): TextBoxEditorAPI;
  ```

- Internally:
  1. Build a one-page `PaginatedLayout` shim where the only "page"
     covers `(0, 0, contentWidth, contentHeight)`. This lets us
     reuse `TextEditor`'s page-shaped hit-test paths unchanged.
  2. Construct `Cursor`, `Selection`, `TextEditor` (existing
     classes) wired against the shim and a small `MemDocStore` seeded
     with `blocks`.
  3. On every store change, call `paintLayout(ctx, layout, 0, 0,
     {...})` to repaint the canvas; emit a cursor/selection overlay
     on top.
  4. On `blur` / `Escape`, call `opts.onCommit(getCurrentBlocks())`.
  5. On `detach`, remove the textarea, listeners, and any canvas
     mutations.

- The `setCanvasCursor` hard-code on `canvas[data-role="doc-canvas"]`
  is brittle. Replace with a per-instance setter or have
  `initializeTextBox` give its supplied canvas a unique
  data-attribute (`data-role="text-box-canvas-${id}"`) and pass it
  to TextEditor.

- [x] **Step 3.1: Refactor `setCanvasCursor` to be per-instance**

  Added `TextEditor.setCursorTarget(el)` setter + a private
  `cursorTarget` field. `setCanvasCursor` now writes to the explicit
  target when present and falls back to the historical
  `canvas[data-role="doc-canvas"]` query when not. The existing
  `initialize` factory wires the just-created canvas via
  `textEditor.setCursorTarget(canvas)` so the docs editor's behaviour
  is byte-identical (the new target is the same element the old
  selector resolved to). Slides text-boxes pass their per-textbox
  canvas, eliminating the cross-instance collision the spike
  flagged.

- [x] **Step 3.2: Write `initializeTextBox`**

  Created `packages/docs/src/view/text-box-editor.ts`. The factory
  builds a one-page `PaginatedLayout` shim (margins zeroed, paper
  size = `(contentWidth, contentHeight)`, single `LayoutPage`
  carrying one `PageLine` per layout line). Hit-test math composes
  cleanly because `paginatedPixelToPosition`'s page-finding +
  margin-stripping collapses to the identity transform under the
  shim, except for `Theme.pageGap` — `getPageYOffset(0)` returns
  `pageGap` regardless, so the factory passes
  `getCanvasOffsetTop = () => -Theme.pageGap` to the TextEditor (so
  pointer Y math compensates) and translates cursor / selection
  pixel coords by `-pageGap` before forwarding to `paintLayout`.
  Renderer drives a `requestAnimationFrame` loop; `onCommit` fires
  on blur via `TextEditor.onFocusChange`; Escape calls
  `onCancel` then blurs (which routes through `onCommit`); detach
  removes the textarea and tears down cursor blink. No CRDT, no
  scroll, no header/footer — exactly what slides text-boxes need
  in v1.

- [x] **Step 3.3: Re-export from `packages/docs/src/index.ts`**

  Added:
  - `TextEditor` (class, from `./view/text-editor.js`)
  - `initializeTextBox`, `TextBoxEditorAPI`, `TextBoxEditorOptions`
    (from `./view/text-box-editor.js`)
  - `paintLayout`, `PaintLayoutOpts` (from `./view/paint-layout.js`)
  - `findPositionAtPixel`, `PixelPosition` (from
    `./view/find-position-at-pixel.js`)

- [x] **Step 3.4: Verify**

  - `pnpm --filter @wafflebase/docs typecheck` — clean
  - `pnpm --filter @wafflebase/docs test` — 746 / 746 green
    (5 new smoke tests for `initializeTextBox`, all 741 prior tests
    unchanged)
  - `pnpm --filter @wafflebase/docs build` — built (Vite + dts
    rollup green)
  - `pnpm verify:fast` — green (architecture + frontend + backend +
    sheets + slides + cli + docs lanes all pass; exit 0)

- [ ] **Step 3.5: Commit**

```bash
git commit -m "Add initializeTextBox factory + re-exports for slides" -m "initializeTextBox is the slides-friendly sibling of initialize:
takes a host-supplied container + canvas + initial Block[] +
content rect, returns a TextBoxEditorAPI with focus/blur/detach.
Internally wires Cursor + Selection + TextEditor + a one-page
PaginatedLayout shim against an in-memory MemDocStore so the
host never sees pagination. Calls onCommit(blocks) on blur or
Escape.

setCanvasCursor's hard-coded canvas[data-role='doc-canvas']
selector is replaced by a per-instance attribute so multiple
text-boxes can coexist on the same slide.

paintLayout, findPositionAtPixel, TextEditor, initializeTextBox
are now exported from @wafflebase/docs.

No behaviour change for the existing docs editor. Phase 5a's slides
wiring (T4) consumes initializeTextBox.

Refs packages/slides/spike/docs-richtext-audit.md 'Required exports'."
```

---

## Task 4: Slides text-box editor wiring

**Goal:** Double-click a `TextElement` on the slide canvas → mount
an `initializeTextBox` instance inside the selection overlay sized
to the text frame. Single click anywhere else / blur / Escape commits
the new blocks back via `store.withTextElement`.

**Files:**
- Create: `packages/slides/src/view/editor/text-box-editor.ts`
- Create: `packages/slides/src/view/editor/text-box-editor.test.ts`
- Modify: `packages/slides/src/view/editor/editor.ts` (dblclick
  handler + edit-mode state)

**Approach:**
- Editor gains a private `editingElementId: string | null` state.
- On `dblclick` on a text element body: enter edit mode by mounting
  a per-textbox canvas + container inside the existing overlay,
  positioned to the text frame. Call `initializeTextBox`. Hide
  selection handles while editing.
- On `blur` / `Escape` / clicking another element: exit edit mode,
  detach the TextBoxEditor, restore selection handles, write the
  final blocks back through `store.batch(() => store.withTextElement(slideId, elementId, () => newBlocks))`.

- [x] **Step 4.1: Write the slides text-box-editor module**

  Slim wrapper landed at
  `packages/slides/src/view/editor/text-box-editor.ts` exporting
  `mountSlidesTextBox(opts): SlidesTextBoxEditor`. Builds the canvas
  + container DOM inside `overlay`, positioned at `frame * scale`,
  with `pointer-events: auto` so clicks land on the editor instead
  of falling through to the slide canvas. Rotation is applied via
  CSS `transform` for rotated frames. The wrapper exposes `focus`,
  `commit`, `detach`, `isEditing`, and a public `container` ref so
  the editor can hit-test "click inside vs outside" cheaply. Calls
  `initializeTextBox` from `@wafflebase/docs` and routes
  commit/cancel back through the supplied callbacks.

- [x] **Step 4.2: Wire double-click + edit mode in editor.ts**

  Editor gains a private `editingElementId: string | null` plus
  `editingTextBox: SlidesTextBoxEditor | null` field, an injected
  `mountTextBox` factory (overridable via `SlidesEditorOptions`,
  used by tests), and three new methods:
  `enterEditMode(slideId, elementId)`, `exitEditMode(reason)`,
  `finishEditMode()`. `dblclick` listeners on canvas + overlay
  hit-test for text elements and call `enterEditMode`.
  `repaintOverlay` filters out `editingElementId` when computing
  the selected set (handles disappear) and re-appends the text-box
  container after `renderOverlay` clears the overlay. `onPointerDown`
  short-circuits while editing: clicks inside the text-box
  container pass through to the docs editor; clicks outside
  trigger commit + exit. `onCommit` writes back via
  `store.batch(() => store.withTextElement(...))`. `detach()` tears
  the text-box down so the editor leaves no orphaned DOM.

- [x] **Step 4.3: Add tests**

  `packages/slides/src/view/editor/text-box-editor.test.ts` (8
  tests, all passing). Covers:
  - Double-click on a text element enters edit mode.
  - Double-click on a non-text element does NOT enter edit mode.
  - Selection handles disappear for the editing element.
  - Committed blocks persist via `store.withTextElement` (one
    undo entry, blocks reflect the commit).
  - Clicking outside the text-box commits + exits.
  - Clicking inside the text-box does NOT exit.
  - Cancel (Escape) followed by the docs-editor's blur path
    leaves the original blocks unchanged.
  - `editor.detach()` during edit mode tears the text-box down.

  Tests inject a mock `mountTextBox` via `SlidesEditorOptions` so
  the docs `initializeTextBox` (which needs a real Canvas 2D
  context) doesn't run in jsdom. Mock exposes `fireCommit` /
  `fireCancel` for the test to drive commit/cancel synchronously.

- [x] **Step 4.4: Verify**

  - `pnpm slides typecheck` — clean.
  - `pnpm slides test` — 26 files / 185 tests green (8 new).
  - `pnpm verify:fast` — exit 0 (architecture, frontend lint +
    test, backend, sheets typecheck + test, slides typecheck +
    test, cli typecheck + test, docs typecheck + test all pass).

- [x] **Step 4.5: Commit**

```bash
git commit -m "Wire double-click text editing in slides editor" -m "Double-click a text element → mount the new initializeTextBox
factory from @wafflebase/docs inside the selection overlay,
positioned to the text frame. Selection handles disappear while
editing; blur or Escape commits the new Block[] via
store.withTextElement and restores the handles.

Phase 5a's biggest user-visible win: typing finally works. IME
composition (Korean / CJK / etc.) and the docs editor's
copy/paste/undo all come along for free because we're hosting the
same TextEditor instance the docs editor uses.

Refs docs/design/slides/slides.md 'Interactions > Enter text edit'."
```

---

## Task 5: Yorkie Tree for text element bodies + notes

**Goal:** Migrate `TextElement.data.blocks` and `Slide.notes` from
plain `Block[]` JSON inside the Yorkie root to `Yorkie.Tree`.
Concurrent text edits then converge character-by-character per the
docs Tree CRDT semantics, instead of last-write-wins on the whole
`blocks` array.

**Files:**
- Modify: `packages/frontend/src/types/slides-document.ts` — typed
  Tree fields
- Modify: `packages/frontend/src/app/slides/yorkie-slides-store.ts`
  — Tree initialisation + Tree-backed `withTextElement` / `withNotes`

**Approach:**
- Mirror the docs migration pattern (`packages/docs/src/view/docs-view.tsx`
  `ensureTree` helper) — a Tree must be created via `new Tree(initialNodes)`
  inside `doc.update`, not passed as plain JSON in initialRoot.
- `ensureSlidesRoot` becomes responsible for: when a slide is added,
  initialise its text elements' `data.tree` and the slide's
  `notes.tree` as Yorkie.Trees seeded with the equivalent Block[]
  shape that ensureTree in docs uses.
- `withTextElement` / `withNotes` hand back an editor-facing Block[]
  view (read from Tree → flatten to Block[]) and on commit serialise
  Block[] → Tree mutations. The TextEditor in T4 emits diffs (insert
  text / delete / split block / merge block), which YorkieDocStore
  already knows how to apply to a Tree — adapt the pattern.

- [x] **Step 5.1: Update types**

  `YorkieTextElement.data` is now `{ tree: Tree }` and
  `YorkieSlide.notes` is now `Tree`. A separate `YorkiePlaceholder`
  union keeps layout placeholders as plain `{ blocks: Block[] }`
  shapes (Trees can't live in a static `BUILT_IN_LAYOUTS` constant —
  they must be `new Tree(...)`'d inside `doc.update`). The Tree gets
  materialised when `addSlide` / `applyLayout` instantiates the
  placeholder into a real element.

- [x] **Step 5.2: Initialise Trees in `ensureSlidesRoot` + `addSlide`
  + `addElement`**

  `ensureSlidesRoot` now also walks any pre-existing slides and
  materialises a Tree for `notes` and each text element's `data.tree`
  if it isn't a Tree CRDT yet (legacy `Block[]` JSON gets dropped —
  Phase 5a accepts the wire-format break). `addSlide`, `addElement`,
  `duplicateSlide`, `applyLayout`, `moveSlide`, `moveSlides`,
  `reorderElement`, and `replaceRoot` all `new Tree(...)` text bodies
  + notes inside `doc.update`. Reorder paths can't shuffle Yorkie
  array proxies (Tree refs are singletons), so they rebuild slides /
  elements with fresh Trees seeded from the source's flattened
  blocks.

- [x] **Step 5.3: Replace `withTextElement` / `withNotes` Tree
  bridge**

  Phase 5a-1 ships a SHALLOW Tree migration: the storage shape is
  `Tree`, but `withTextElement` / `withNotes` keep the existing
  `(blocks: Block[]) => Block[] | void` callback API. On commit, the
  returned `Block[]` is written by replacing the tree's contents
  (`editByPath` delete + `editBulkByPath` insert). This preserves the
  T4 wiring (text-box-editor → onCommit(blocks)) without touching
  consumers.

  Trade-off: concurrent edits inside the same body resolve as
  last-write-wins on commit (same single-user behaviour as before,
  multi-user converges only between commits). Per-keystroke Tree
  mutations for true character-level convergence are tracked as
  Phase 5a-2.

- [x] **Step 5.4: Update equivalence tests**

  The existing equivalence tests (which compare via `stripIds`)
  initially failed on `notesLength` because a freshly-initialised
  Tree carries an empty paragraph (Trees can't be empty — the cursor
  needs an anchor block) while MemSlidesStore represents empty notes
  as `[]`. The fix lives in `yorkie-slides-store.ts`'s `treeToBlocks`
  helper: a "trivially empty" Tree (single empty paragraph) flattens
  back to `[]` on read, restoring snapshot equivalence with Mem.
  All 6 equivalence tests pass without modification.

- [x] **Step 5.5: Verify**

  - `pnpm --filter @wafflebase/frontend test` — 234/234 green
    (188 pass, 6 newly-passing equivalence tests + 40 skip + 0 fail)
  - `pnpm --filter @wafflebase/slides test` — 185/185 green
  - `pnpm --filter @wafflebase/frontend lint` — clean
  - `pnpm verify:fast` — exit 0 (architecture, frontend, backend,
    sheets, slides, cli, docs lanes all pass)

- [ ] **Step 5.6: Commit**

```bash
git commit -m "Migrate text element bodies + notes to Yorkie.Tree" -m "TextElement.data.blocks and Slide.notes were stored as plain
Block[] JSON inside the Yorkie root, which means concurrent text
edits resolved as last-write-wins on the whole array. Migrating to
Yorkie.Tree gives character-level CRDT convergence — same model the
docs editor uses, same Tree wiring patterns.

The store's read() path still flattens Tree → Block[] so consumers
(canvas renderer, equivalence tests, snapshot serialisation) see
the same shape they did before. Only the underlying Yorkie storage
changes.

withTextElement / withNotes now hand back the live Tree to the
caller so the new initializeTextBox path in T4 can emit per-edit
Tree mutations rather than rewriting the whole array on every
keystroke.

Refs docs/design/slides/slides.md 'Yorkie schema > Text'."
```

---

## Task 6: CJK font fallback in slides canvas

**Goal:** Slides text rendered to canvas falls through to Noto Sans
KR (and any other CJK fallbacks docs already loads) when the inline
text contains characters outside the base font. Reuse the docs font
registry rather than maintaining a slides-side fallback list.

**Files:**
- Create: `packages/slides/src/view/canvas/fonts.ts`
- Modify: `packages/slides/src/view/canvas/text-renderer.ts` (use the
  docs font registry directly)

**Approach:**
- The docs editor already loads Noto Sans KR and other CJK fonts via
  its layout / measurement path (see `packages/docs/src/view/fonts.ts`).
- Slides' `text-renderer.ts` currently calls `computeLayout` from
  `@wafflebase/docs` which uses the same `CanvasTextMeasurer`
  internally — so layout-time width measurement should already be
  CJK-correct.
- The PAINT side might differ: when slides eventually delegates
  paint to T1's `paintLayout`, it inherits docs' font rendering for
  free. Until that's wired (see T7), this task explicitly forwards
  the font registry so any slides-direct fillText calls also see
  Noto Sans KR.

- [ ] **Step 6.1: Verify what docs already does**

  Read `packages/docs/src/view/fonts.ts`. Note how Noto Sans KR is
  loaded (FontFace API? `@font-face` rules in CSS? Web font URL?)
  and whether it ships with the package or needs network fetch.

- [ ] **Step 6.2: Re-export font loader from docs (if not already)**

  If `loadCJKFonts()` (or whatever the docs entry point is) isn't
  on `packages/docs/src/index.ts`, add it. If it auto-runs on
  import, slides gets it for free by importing anything from docs.

- [ ] **Step 6.3: Wire from slides**

  Either (a) ensure slides' demo / SlidesView calls the loader at
  startup, or (b) document that `@wafflebase/docs`'s top-level
  import side-effect already loads the fonts.

- [ ] **Step 6.4: Manual verify**

  In the demo, type Korean into a text element. The canvas should
  render the Korean glyphs without any �missing-glyph fallback.

- [ ] **Step 6.5: Commit**

```bash
git commit -m "Reuse docs font registry for slides CJK rendering" -m "Slides text rendering reuses computeLayout from @wafflebase/docs
which already wires Noto Sans KR via the docs font registry, so
layout-time measurement was always CJK-correct. This commit makes
the paint-time path reuse the same registry explicitly so any
direct fillText calls in slides also pick up the loaded fonts.

Refs docs/design/slides/slides.md 'Rendering pipeline > Korean / CJK
font fallback'."
```

---

## Task 7: Demo verify + tick + final gate

**Files:**
- Modify: `docs/tasks/active/20260505-slides-package-mvp-todo.md`

- [ ] **Step 7.1: `pnpm verify:fast`** — confirm green.

- [ ] **Step 7.2: Manual smoke**

  In two browser windows on the same `/p/:id`:
  1. Double-click a text element. Cursor + IME should appear.
  2. Type Korean (e.g. "안녕하세요"). It should render correctly.
  3. Blur. The text should commit.
  4. The other browser should see the committed text appear.
  5. Both browsers type into the same text element concurrently.
     After sync, both texts should be present (CRDT convergence,
     not last-write-wins).

- [ ] **Step 7.3: Tick checklist**

  Mark items 5.1, 5.2, 5.4 as `[x]` in
  `docs/tasks/active/20260505-slides-package-mvp-todo.md`.

- [ ] **Step 7.4: Commit**

```bash
git commit -m "Tick Phase 5a checklist items" -m "5.1 (text-bridge), 5.2 (Yorkie Tree migration), 5.4 (CJK fonts)
done. Phase 5a complete.

Phase 5b (image input + presentation mode + PDF export) is the next
plan. Phase 5c (CLI + visual harness + verify:full) follows."
```

---

## Phase 5a Done

After Task 7:

- `pnpm verify:fast` is green.
- Users can double-click a text element to enter edit mode, type
  Latin / Korean / CJK with IME composition, and commit on blur or
  Escape.
- Concurrent text edits between two clients converge
  character-by-character via Yorkie.Tree, matching the docs editor's
  conflict semantics.
- The docs editor's behaviour is unchanged (T1-T3 are pure
  refactors verified by existing docs tests).

Phase 5b (image input paths, presentation mode, PDF export) is the
next plan. Phase 5c (CLI + visual harness + verify:full) closes
out the v1 MVP.

## Risks

- **T3 PaginatedLayout shim**: building a one-page shim that
  TextEditor's hit-test paths accept may surface assumptions in
  TextEditor we don't see today. Time-box step 3.2 to half a day;
  if it's still failing, switch to spike option 2 (refactor
  TextEditor to take a hit-test function). The plan can absorb the
  ~half-day overrun.

- **T5 Tree migration**: the YorkieDocStore Tree path is large.
  The slides version doesn't need every operation (no tables, no
  block-level styles deeper than paragraphs in v1) but does need
  the basics (insert/delete text, splitBlock, mergeBlock,
  applyInlineStyle). If T5 grows beyond the budget, split into:
  - T5a: read-side flatten Tree → Block[]
  - T5b: write-side withTextElement/withNotes adapters
  - T5c: equivalence test updates
  The plan currently assumes T5 fits in one task.

- **CJK fonts**: if docs currently relies on a CSS @font-face
  rule served from a specific frontend asset path, slides demo
  (running outside frontend) might not pick it up. T6 step 6.4's
  manual verify is the gate.
