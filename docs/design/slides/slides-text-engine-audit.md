# docs RichText Audit for Slides Phase 5

Status: investigation, no code.

## Summary

Reuse is largely feasible. The model-side primitives — `Doc`, `Block[]`,
`DocPosition`, `DocRange`, `Selection`, `Cursor`, and `computeLayout` —
are page-agnostic and can drive a slides text-box without modification.
The renderer (`DocCanvas.render`) and the entry point (`initialize`) are
both shaped around a paginated, full-page document view and are NOT
reusable as-is for slides. Phase 5 will need a new
`initializeTextBox(container, canvas, store, opts)` factory in
`@wafflebase/docs` plus an `export { TextEditor }` so slides can mount
one IME-bridged editor per active text-box overlay. Estimated cost:
1 small refactor in docs (extract a `TextBoxCanvas` from `DocCanvas`,
add `initializeTextBox`), about 1-2 days of work, no behaviour changes
to the docs editor itself.

## Findings

### computeLayout reusability

`packages/docs/src/view/layout.ts:205-300` — `computeLayout(blocks,
measurer, contentWidth, dirtyBlockIds?, cache?)` is page-agnostic. The
only page-shaped concept it touches is the `page-break` block type
(line 262), which the function treats as a height-zero break — slides
won't ever produce one, so the branch is inert. `contentWidth` is a
single number measured in CSS pixels; passing the slide text-box's
inner content width (after padding) gives a `DocumentLayout` with
`{ blocks, totalHeight, blockParentMap }` that can be drawn directly
without going through `paginateLayout`.

The `LayoutCache` keyed by `(contentWidth, blockId)` works per-
textbox: if the slide has N text-boxes, each gets its own cache, all
sharing the same `CanvasTextMeasurer` instance (the per-measurer
`measureCache` in `layout.ts:35` is keyed by `(font, text)` so
identical strings across text-boxes still hit cache).

Conclusion: zero changes needed in `layout.ts`. Slides' caller can
treat `computeLayout` as a black box.

### IME bridge

`packages/docs/src/view/text-editor.ts:45-252` — `TextEditor` owns the
hidden textarea that captures keyboard / IME events:

- Line 231: `this.textarea = document.createElement('textarea')`
- Line 240: `container.appendChild(this.textarea)` — the textarea is
  appended to whatever `container` the host passes.
- Lines 244-245: `compositionstart` / `compositionend` handlers wire
  IME composition tracking (see `CompositionState` line 26) plus the
  `HangulAssembler` fallback (line 73 + `hangul.ts`) for browsers that
  don't fire composition events for jamo.

`TextEditor` is currently exported from `text-editor.ts` (line 45) but
NOT re-exported from `packages/docs/src/index.ts`. That's the first
gap to fill for Phase 5.

Hostability: the constructor takes 18 parameters, all of which are
either DOM refs (`container`) or store/cursor/selection/layout
accessors. None of them assume a paginated layout or a full-page host —
the only "page-shaped" reference is `getPaginatedLayout` (line 199),
which is consumed by `paginatedPixelToPosition` and friends inside
mouse-down hit testing (line 9 of text-editor.ts). For slides we'd
either:

1. Provide a single-page `PaginatedLayout` shim with one page that
   covers the text-box's content rect. Cheap to author, keeps
   `TextEditor` unchanged.
2. Refactor `TextEditor` to accept a hit-test function instead of
   `getPaginatedLayout`. Cleaner long-term but a larger diff.

Recommendation: ship option (1) in Phase 5 and revisit (2) when slides
needs auto-fit text or vertical alignment that the page-line model
can't express.

### Selection / cursor

`packages/docs/src/view/cursor.ts:18-32` — `Cursor.position` is a pure
`DocPosition = { blockId, offset }`. The class only touches pages in
`getPixelPosition` (line 41), which delegates to
`resolvePositionPixel(paginatedLayout, layout, ...)` for screen
coordinates. The state itself is page-free.

`packages/docs/src/view/selection.ts:668-700` — `Selection.range` is a
pure `DocRange = { anchor, focus, tableCellRange? }`. The same split
applies: `setRange` / `hasSelection` / `getNormalizedRange` are
page-free; only `getSelectionRects` requires a `PaginatedLayout` to
project block-relative positions into screen space.

This is the right shape for slides — the model-level state is
block-relative and travels across CRDT snapshots without any page
context. We just need to give the slides text-box rendering helpers
their own equivalent of `getSelectionRects` that takes a single
`(layout, contentRect)` pair instead of a `PaginatedLayout`.

### Paint pipeline

`packages/docs/src/view/doc-canvas.ts:103-810` — `DocCanvas.render`
takes a `PaginatedLayout` and walks pages, drawing per-page
backgrounds, shadows, page numbers, headers, footers, etc. The text /
inline-run renderer inside (`renderRun`, line 693) is what slides
actually wants — it consumes `LayoutLine`s and `LayoutRun`s, not
pages — but it's a private method and currently mixed into a paint
loop that assumes pages.

For slides we need either:

1. Extract a public `paintLayout(ctx, layout, originX, originY, opts)`
   helper that walks `layout.blocks[].lines[].runs[]` without page
   chrome. The slides text-box renderer would call this inside its own
   shape transform.
2. Or copy/inline a slimmer renderer in `@wafflebase/slides` that
   re-implements the run-painting loop. Faster to land but duplicates
   a fair bit of complex code (sub/sup baseline math, RTL handling,
   list markers, etc.).

Recommendation: option (1). The extraction is mechanical — separate
the per-page wrapping from the per-line painting — and removes a
sizeable chunk of duplication risk.

### Required exports

The following are already exported from `@wafflebase/docs/index.ts` and
slides can use them as-is:

- `Doc`, `MemDocStore`, `DocStore` — model + storage.
- `computeLayout`, `LayoutBlock`, `LayoutLine`, `LayoutRun`,
  `DocumentLayout` — block-relative layout pass.
- `Cursor`, `Selection` — state classes.
- `CanvasTextMeasurer`, `TextMeasurer`, `ResolvedFont` — measurement
  abstraction.
- `Theme`, `buildFont`, `ptToPx` — typography helpers.
- `resolvePositionPixel` (via `peer-cursor.ts`) — used today for peer
  cursors but generic enough to pixel-project any `DocPosition`.

The following are NOT exported and slides will need:

| Surface | File | Why slides needs it |
|---|---|---|
| `TextEditor` (class + constructor params) | `view/text-editor.ts:45` | The IME bridge. Slides will instantiate one per active text-box. |
| `HangulAssembler` (already private) | `view/hangul.ts:1` | Mobile-Safari fallback for Korean composition; `TextEditor` uses it internally — slides gets it transitively if `TextEditor` is exported. |
| `paintLayout(ctx, layout, ...)` (does not exist yet) | new helper, extract from `view/doc-canvas.ts:135-810` | Page-free renderer — see the **Paint pipeline** finding above. |
| `findPositionAtPixel(layout, x, y)` (does not exist yet) | extract from `view/pagination.ts:342` `paginatedPixelToPosition` | Hit-testing inside a single text-box without going through pages. |
| `initializeTextBox(opts)` (does not exist yet) | new entry point, sibling of `initialize` in `view/editor.ts` | Slides-friendly factory: pass an existing canvas + container + content rect, get back a smaller `TextBoxEditorAPI`. |

The internal-only `LayoutCache`, `cachedMeasureText`, and the
`measureCache` registry don't need to be re-exported — slides accesses
them transitively through `computeLayout`.

### Frontend coupling

The `TextEditor` constructor takes a `container: HTMLElement` and
appends both the hidden textarea and (indirectly through `editor.ts`)
the canvas to it. Slides text-boxes already have a per-element overlay
container (see `packages/slides/src/view/editor/overlay.ts`); the
Phase 5 plan should reuse that overlay as `TextEditor.container` so
focus/blur and event scoping match what the rest of the slides editor
does.

The `setCanvasCursor` helper (`text-editor.ts:188`) hard-codes
`canvas[data-role="doc-canvas"]` as the selector. That's brittle if
slides supplies its own canvas; either expose a setter
`setCursorTarget(el)` or have `initializeTextBox` install its own
data-role attribute. Same trick fixes hit-testing (see
`Required exports` row 4 above).

## Recommendation

Phase 5 plan, rough order:

1. **Refactor pass in `@wafflebase/docs`** (~1 day, no behaviour change)
   - Extract `paintLayout(ctx, layout, originX, originY, opts)` from
     `DocCanvas.render`. Keep `DocCanvas.render` as a thin wrapper
     that calls it once per page.
   - Extract `findPositionAtPixel(layout, x, y)` from
     `paginatedPixelToPosition`. Keep the paginated function as a
     thin wrapper.
   - Add `initializeTextBox({ container, canvas, store, contentWidth,
     contentHeight })` returning a slim `TextBoxEditorAPI`. Internally
     wires a `Cursor`, `Selection`, `TextEditor`, and a single-page
     `PaginatedLayout` shim.
   - Re-export `TextEditor`, `paintLayout`, `findPositionAtPixel`,
     `initializeTextBox` from `packages/docs/src/index.ts`.
   - Replace `setCanvasCursor` with a setter or per-instance data-role.
   - **Verification**: `pnpm docs test` + `pnpm verify:fast` green;
     the existing `initialize` path still passes its tests
     unchanged.

2. **Slides text-box wiring** (~2 days)
   - In `@wafflebase/slides`, add `view/editor/text-box-editor.ts`
     that, on entering edit mode for a `TextElement`, calls
     `initializeTextBox` against an overlay-mounted canvas+container
     sized to the text-box frame.
   - Translate slides' `TextElement.frame` → `contentWidth` /
     `contentHeight` (subtract per-side padding).
   - On commit (Escape, blur, switch-element), tear down the
     `TextBoxEditorAPI` and write the final `Block[]` back through
     `store.updateElement`.
   - Bridge focus/blur with the slides selection ring so the existing
     drag/resize handles disappear while the text is in edit mode.

3. **CRDT plumbing follows in Phase 5b** — `TextElement.blocks` is
   already a `Block[]` field; the Yorkie path will mirror what
   `@wafflebase/docs` does with `Tree` once the editor is wired.

The investigation confirms slides should NOT fork or duplicate the
docs RichText engine. The docs surface is structurally close enough
that the gap is "expose what's already private and extract a paint
helper", not "rewrite". That's the central finding of this audit.
