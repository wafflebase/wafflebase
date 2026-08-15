# Docs: resetting the font color paints the selection color (#728)

## Problem

In the docs editor, selecting text and clicking **Reset** in the text-color
picker leaves the text painted in the selection highlight color instead of
clearing the color.

Root cause — two layers:

1. The toolbar reset writes an **empty string** (`applyStyle({ color: "" })`)
   instead of clearing the key. `""` is a legal `string`, so
   `serializeInlineStyle` stores `color: ""` on the Yorkie Tree node and
   `defaultColorResolver` passes it through verbatim.
2. `paintRun` falls back with `??`, so `""` survives and
   `ctx.fillStyle = ""` is an **invalid** assignment — the Canvas spec says
   invalid color strings are ignored, so `fillStyle` keeps whatever the
   previous paint pass set. The selection rects are filled right before the
   run pass, so the text renders in `theme.selectionColor`.

## Plan

- [x] Toolbar reset clears the key: `applyStyle({ color: undefined })` /
      `{ backgroundColor: undefined }`. The Yorkie store already turns an
      explicitly-`undefined` key into `removeStyleByPath`
      (`removedInlineStyleAttrs`), so the attribute really leaves the CRDT.
      - [x] `components/text-formatting/text-format-group.tsx` (shared docs +
            slides toolbar)
      - [x] `app/docs/docs-formatting-toolbar.tsx` (slim/mobile toolbar)
- [x] Renderer treats a falsy resolved color as unset, so documents already
      saved with `color: ""` (and slides decks, which paint through the same
      docs `paintRun`) render with the theme default instead of a stale
      `fillStyle`. One shared helper, `resolveStoredColor(resolve, c)` in
      `model/color.ts`, normalizes `""` on **both** sides of the resolver —
      before, so a theme-aware resolver takes its "no color set" branch and
      returns the deck theme's text color (normalizing only after would paint
      a cleared run in the docs default on a dark deck); after, so a resolver
      that itself yields `""` never reaches `ctx.fillStyle`. Call sites:
      - [x] `paintRun` text color (and `underlineColor`, same shape)
      - [x] `renderListMarker` marker color
      - [x] `resolveColorAtPosition` (caret color tracks the run color)
      - [x] `table-renderer.ts` cell text + in-cell list markers — table
            blocks never pass through `paintRun` (paint-layout skips
            `block.type === 'table'`; the table renderer sets its own
            `ctx.font` / `ctx.fillStyle`), so text inside a table needed the
            same guard explicitly
- [x] DOCX export normalizes the resolved color into a valid `ST_HexColor`
      before writing `<w:color>` / `<w:shd w:fill>` (`toDocxHexColor` in
      `export/docx-style-map.ts`). `InlineStyle.color` and `CellStyle`
      `backgroundColor` can legitimately hold an arbitrary string (DOCX/PPTX
      import, HTML paste's `rgb(…)`, the legacy `''`), which emitted verbatim
      is both OOXML attribute injection and a schema-invalid attribute. The
      recognized CSS forms convert; anything else drops the attribute.
      Applied to **both** sinks — the run properties and the table cell fill
      in `export/docx-exporter.ts`, which writes the same attribute
- [x] One shared normalizer, `toRgbHexColor` in `model/color.ts`, backs both
      export sinks (`toDocxHexColor` is now its DOCX-facing name) — the
      "`''` means unset" convention is expressed once instead of per sink.
      It also drops a **fully transparent** color (`rgba(r,g,b,0)`,
      `#RRGGBB00`) rather than returning its RGB triplet: neither `w:shd`
      nor `<a:srgbClr>` carries alpha, so keeping it would paint a solid
      block behind text that is invisible on screen. Partial alpha still
      keeps the triplet (rendered opaque)
- [x] PPTX export runs colors through the same normalizer
      (`storedColorToThemeColor` in `export/pptx/text.ts` now returns
      `ThemeColor | undefined`): slide text boxes are edited by the docs
      `TextEditor`, so HTML paste writes `rgb(255, 0, 0)` into
      `Inline.style.color`, and the #728 reset reaches the exporter both as
      `''` and as `{ kind: 'srgb', value: '' }` — all of which
      `colorChildXml` would have written into `<a:srgbClr val>` as an
      invalid `ST_HexColorRGB` that PowerPoint rejects. Covers run color,
      highlight, underline fill and the bullet marker color
- [x] Tests
      - [x] docs: `paint-layout.test.ts` — a run with `color: ''` paints the
            theme default, never the previously set `fillStyle`
      - [x] docs: `render-list-marker.test.ts` — `marker.color: ''` /
            `inline.color: ''` paint the theme default, and the resolver sees
            `undefined` (not `''`) so themes still apply
      - [x] docs: `color.test.ts` — `resolveColorAtPosition` falls back for
            `''` on both the covering-inline and trailing-inline branches;
            `resolveStoredColor` unit cases
      - [x] docs: `table-renderer.test.ts` — cell text and in-cell list
            marker with `color: ''` paint the theme default, not the
            pre-loaded selection fill
      - [x] docs: `paint-layout.test.ts` — `underlineColor: ''` strokes the
            run's text color (theme default when the run has none), and an
            explicit `underlineColor` still wins
      - [x] docs: `docx-style-map.test.ts` — hostile / non-hex color and
            backgroundColor values drop the attribute; `toDocxHexColor`
            unit cases (hex forms, `rgb()`/`rgba()`, transparent, rejects)
      - [x] docs: `color.test.ts` — `toRgbHexColor` unit cases, including
            fully transparent → `undefined` and partial alpha → triplet
      - [x] docs: `docx-exporter.test.ts` — a table cell background
            normalizes into `<w:shd w:fill>`, a hostile one emits nothing
      - [x] slides: `export/pptx/text.test.ts` — `''` color / background /
            underline color emit no color children, the
            `{ kind: 'srgb', value: '' }` object form is unset too, CSS
            `rgb()`/`rgba()` normalize into `val="RRGGBB"`, and a named /
            hostile color drops the child
      - [x] frontend: reset calls `applyStyle` with `color: undefined`
      - [x] frontend: `color-reset.test.ts` — the **slim header/footer**
            toolbar's own text/highlight resets clear the key too. Separate
            call site from `TextFormatGroup`, so the shared-group test above
            passes whatever the slim toolbar does
      - [x] frontend: `docs-table-context-menu.test.tsx` — the cell
            background "Reset" clears `backgroundColor` instead of writing
            `""`, and a swatch still passes its color through
      - [x] backend: `docs-content.controller.spec.ts` — an absent
            `TextBody.blocks` / `Block.style` is filled in with its empty
            shape (text element, shape text, table-cell body, notes), and an
            array is rejected as a block style
      - [x] slides: `export/pptx/color.test.ts` — a `role` outside the closed
            set (`constructor`, `__proto__`, …) emits black, not a
            prototype-chain value or `val="undefined"`

## Scope grown during review

Everything above is issue #728. The work below is not — each item was pulled
in by a *blocking* review finding on the hop before it, so none of it could be
dropped without leaving the branch red, and none of it was foreseeable when
the plan was written. Recording the chain here because a reader who diffs the
branch against the issue will otherwise find ~2.5k insertions with no
explanation, and because the split decision needs to be on the record rather
than re-litigated per round.

Chain, in the order it was forced:

1. **Sink normalization** (`toRgbHexColor`) — the fix for the legacy `''`
   color had to run at the DOCX/PPTX attribute sinks, not at the toolbar,
   because import and HTML paste write colors too. *(Above; still #728.)*
2. **The rest of the color sinks** — a security finding: once one attribute
   sink normalizes, the sibling sinks that interpolate the same untrusted
   `InlineStyle` string (`<a:srgbClr val>`, the 12 `<a:clrScheme>` slots,
   `<w:shd w:fill>`) are the *same* hole. Closing one and not the others is
   not a fix.
3. **The non-color OOXML attributes** — a follow-on blast-radius finding:
   the color sinks were not the only place a JSON-sourced string reached an
   XML attribute unescaped. Shape `prst`, `prstDash`, `algn`, arrowheads,
   connector routing, layout type, transition tag, animation integers, DOCX
   `w:jc` / `w:pStyle` / heading ids. Converted to closed `Map` lookups and
   numeric coercion — injection-free by construction, not by escaping.
   This is the item design-fit review flags as unrequested scope; it is
   correct on the merits and is why the exporters gained ~600 lines.
4. **The content PUT validator** — the sinks above are hardened, but
   `PUT /api/v1/…/content` stores a deck's blocks verbatim, so the API was
   the delivery path for exactly the values the sinks now drop. The slides
   arm gained a text-body walk; the docs arm gained block/header/footer
   shape checks.
5. **`crdt-attrs.ts` codec extraction** — the validator needed the same
   block-attribute serialize/parse rules the frontend Yorkie store already
   had. Deduplicated into `@wafflebase/docs` rather than copied into the
   backend.
6. **`removeNodeStyle` / `removedCellStyleAttrs` / the table-block inline
   fix** — clearing a style key by passing `undefined` (the #728 mechanism)
   turned out to be broken for *cell* styles: the removal range spanned the
   cell's whole subtree. Fixing it exposed the sibling `setBlockType`
   splice. See the lessons file.

**Split decision:** deliberately not split. Items 2–6 are each a blocking
finding's remedy on a chain rooted in #728, and every one of them touches
either the same color path or the validator that feeds it; landing them
separately would mean shipping a branch that the review panel already
rejected, and re-basing five dependent PRs through the same panel. The cost
is a large diff for a small title, which this section exists to explain.
Design-fit review rated the same scope minor/non-blocking in an earlier
round.

## Acceptance criteria (from the issue)

- Type text, select it, reset the text color → the text is uncolored
  (default ink), not the selection color.

## Known limitations (non-blocking review findings left open)

Verified against the branch and deliberately not fixed here — each would
extend the scope the section above already argues is too large, and none is
reachable through the shipped UI:

- **`docs-tree.ts:317` `treeNodeToCell` synthesizes `id: ''` for a table cell
  with no block children**, and the docs arm of `PUT` requires a non-empty
  block id — so `GET` → `PUT` of such a cell 400s. Reachable only by first
  `PUT`ting `cell.blocks: []`, a shape no editor produces (`insertTable` and
  every cell-creating path write a paragraph). Both candidate fixes change a
  contract: minting an id in the reader makes `GET` non-idempotent, and
  requiring a non-empty `cell.blocks` on write is a new rejection. Worth a
  follow-up with its own acceptance criterion.
- **`yorkie-doc-store.ts:1469` `setBlockType` guards on the *target* type.**
  Converting an existing table block to a paragraph would still splice an
  inline in front of row 0. The docs UI never puts the caret on a table block
  itself (the styles dropdown acts on the block inside the cell), so the call
  cannot be made today; a real fix has to decide what "turn a table into a
  paragraph" means for the rows, which is a feature question.
- **`yorkie-doc-store.ts:1918` still clears inline styles with
  `removeStyleByPath`.** Not a defect: an inline node's only children are text
  nodes, and Yorkie's removal applies to element nodes, so the range cannot
  over-remove. Converting it to `removeNodeStyle` would be cosmetic.
- **`MemoryDocStore.setBlockType` lacks the table/inlines guard** its Yorkie
  sibling gained. The guard exists to stop a Tree node splice from shifting
  every `[table, row, cell, …]` path by one; `MemoryDocStore` assigns a plain
  `block.inlines` array, and the layout engine reads `tableData`, never
  `inlines`, for `type === 'table'`. Cosmetic there, not a corruption.
- **`DocumentCopyService` reaches `writeDocsRoot` without
  `assertValidDocsBody`.** It feeds `writeDocsRoot` the output of
  `readDocsRoot` on a document this same backend stored — content its own
  writer produced, not caller input, so the validator has nothing to reject.

## Non-goals

- No change to the color palette, picker UI, or the highlight-color rendering
  path (highlight already short-circuits on a falsy value).
- No migration pass over existing documents — the renderer guard makes
  already-stored `""` values render correctly, and the next reset removes them.
