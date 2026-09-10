# Docs: changing a list item's level carries its nested children

Issue: [#1050](https://github.com/wafflebase/wafflebase/issues/1050)
Design note: [docs/docs.md § Changing a list level carries the subtree](../../design/docs/docs.md)

## Problem

Every list-level entry point walks only the blocks the selection covers, so a
parent demoted by one level lands on the same level as its own children and the
hierarchy is destroyed:

- Tab / Shift+Tab — `packages/docs/src/view/text-editor.ts` `handleTab`
- Cmd+] / Cmd+[ — `text-editor.ts` `handleIndent` / `handleOutdent`
- toolbar indent / outdent — `packages/docs/src/view/editor.ts`
- the same pair in `packages/docs/src/view/text-box-editor.ts` (Slides / Board)

## Decisions (the four boundary cases from the issue)

"Child" = the following contiguous run of `list-item` blocks whose `listLevel`
is strictly greater than the item's own, stopping at the first block that is
not a list item or is at the same-or-shallower level. This is the rule Word and
Google Docs use to *render* the hierarchy, and the only one the flat
`listLevel` model can express.

1. **Outdent** — yes, symmetric: decreasing a parent's level pulls its whole
   subtree up by one, preserving relative depth.
2. **Floor** — a parent already at level 0 cannot outdent, so the gesture is a
   no-op for that subtree; the children do **not** move on their own (that
   would flatten them into siblings of the parent — the very symptom).
3. **Multi-block selection** — a selected block that is already *moved* as
   part of an earlier selected item's subtree is skipped, so each child moves
   exactly once. A subtree whose root a boundary refused suppresses **only
   itself**: its members stay eligible, so a deeper one the user also selected
   is reconsidered as a subtree root and moves if it has room. (Revised in
   round 9 — see "Review follow-ups". Suppressing them as well, which is how
   (2) first read, made select-all + Shift+Tab a no-op on any document whose
   first list item is a root.)
4. **Ceiling** — `MAX_LIST_LEVEL` (8) refuses the whole subtree when its
   *deepest* member is already at the ceiling. Clamping only the child would
   collapse the parent onto it and reproduce the bug; refusing keeps the one
   invariant this change is about — relative depth is preserved, or nothing
   moves.

Non-list blocks in the selection keep their existing `marginLeft ± 36`
behavior, untouched by the subtree rule.

## Plan

- [x] `packages/docs/src/model/list-level.ts` — pure `planListLevelChanges()`
      over a `(block, siblings)` iterator; returns the block → new level plan
      for the whole gesture, computed before anything is written.
- [x] Thread the containing sibling array through the three
      `forEachBlockInSelection` implementations (`(block, siblings) => void`).
- [x] Route all four entry points (6 handlers) through the plan.
- [x] Unit tests: parent+children Tab/Shift+Tab, floor, ceiling, multi-block
      dedupe, non-list-item boundary, text-box editor.
- [x] Record the rule in `docs/design/docs/docs.md`.

## Out of scope

- Auto-normalizing levels that are already broken (a level-3 item under a
  level-0 one).
- Enter/Backspace/paste level behavior.
- OOXML `w:ilvl` model change — hierarchy stays implied by adjacency.

## Review follow-ups

- [x] `normalizeListLevel` at **every** point of use, not just the planner and
      the two crash sinks. The body indent (`layout.ts`) and the PDF painter
      were clamped first, leaving their on-screen twins raw — so screen
      geometry could disagree with the clamped indent, and the NaN
      `marginLeft` the PDF fix removed still reached canvas:
      `table-layout.ts` (cell indent), `doc-canvas.ts` + `paint-layout.ts`
      (body marker), `table-renderer.ts` (cell marker, also a `Map` key that
      a NaN level would never match on reset), `peer-cursor.ts` ×2
      (empty-line caret x).
- [x] `EditorAPI.indent()` / `outdent()` flush the pre-edit caret *before*
      opening `doc.batch()`, the same ordering the three `text-editor.ts`
      gestures use — `YorkieDocStore` drops a non-history presence write
      issued inside a batch, so undo of a toolbar indent reversed to a stale
      caret (#523).

### Round 9

- [x] **The paste sanitizer bands what the CRDT readers band.**
      `view/clipboard.ts` is the other *producer* of `fontSize`, an inline
      image size, `rowHeights` and cell `padding`, and it admitted any finite
      number — so a pasted `1e9` entered the model out of band while every
      other reader re-read it banded (divergent render; an oversized image
      dropped entirely on the next read).
- [x] **Outdent no longer refuses sibling subtrees that have room.** See
      decision (3) above: select-all + Shift+Tab was a no-op whenever the
      first list item was at level 0.
- [x] **One clamp for a row height, at the layout boundary.**
      `paginatableRowHeight` clamped only what the paginator consumed, leaving
      `LayoutTable.rowHeights` / `rowYOffsets` / `totalHeight` raw — so the
      renderers, hit-tests and selection geometry disagreed with pagination
      about a clamped row (and `totalHeight`, the scroll extent, stayed
      `NaN`). `computeTableLayout` step 5d now substitutes `MIN_ROW_HEIGHT`
      for a non-finite height, and `MAX_ROW_PAGE_SPAN` bounds the loop by
      *fragment count* so the fragments still sum to the published row height.
- [x] **Poisoned-value tests for the frontend `YorkieDocStore`** — the
      duplicate parser that reads a hostile peer's attributes in production,
      in a package with no `tsc` lane. Five cases, read back through a second
      store over the same Yorkie document (the writer answers from its cache).
- [x] `Doc.siblingBlocksOf` direct tests, including the header/footer
      table-cell case and both parent-map fallbacks; the text-box editor's
      undo/`marginLeft` branches; one paint-side out-of-band `listLevel` case.
- [x] Fold the two surviving copies of a band into the band: the slides PPTX
      exporter's `Math.min(8, …)` and the frontend picker's
      `FONT_SIZE_MAX = 400`.
- [x] Record the pagination bound in its own subsystem doc
      (`tables/docs-table-row-splitting.md` §1.5, plus a pointer from
      `docs-pagination.md`); `docs.md` keeps the model half and cross-refers.
- [x] Delete `normalizeRowHeights` (the array form) — no caller, no test, not
      re-exported.
- [x] Correct `parseBlockStyleAttrs`'s claim that the v1 write validator
      "rejects exactly the values dropped here" — it accepts any finite
      `lineHeight`.
- Rejected: the dirty-mark in `editor.ts`'s `applyListLevelChanges` reads
  `doc.blockParentMap`, but `computeLayout` recomputes every `table` block
  before it reaches the layout cache, so the mark is inert for a cell child
  either way. Asserted with the map entry deleted rather than changed.
- Follow-up, not built here: `isPaintableImageSize` *drops* an image taller
  than 20000 px and no insert path bounds height, so a narrow-but-tall image
  (width under the ~624 px content width, so `clampImageToWidth` scales
  nothing) silently vanishes on the next read. Wants a proportional clamp
  helper at the three read boundaries, or a height bound at insert.

### Round 10

A local 5-lens panel found no blocking and no confirmed-major finding. Four
of what it did find were defects in round 9's own fixes, and two were tests
that guarded nothing — closed here; the numeric-hardening program is not
extended to any new attribute.

- [x] **Regression: the deduped list-level ceiling dropped a coercion.**
      Round 9 routed the PPTX exporter's `listLevelAttr` through
      `normalizeListLevel` to remove the third copy of `[0, 8]`, but the old
      `Math.min(8, Math.trunc(Number(...)))` coerced and `normalizeListLevel`
      takes a `number`. A numeric-string `listLevel` — what a level is after a
      round trip through JSON, which is how a slides text body is persisted —
      exported at level 0. Coerced at the sink, band still shared; the JSDoc
      no longer claims the band coerces.
- [x] **`lineHeight` at the paste boundary.** Round 9's own band-parity claim
      did not hold: the paste sanitizer banded `fontSize`, image size,
      `rowHeights` and cell `padding` but not `lineHeight`, and the clipboard
      test did not assert the gap. Reuses `normalizeLineHeight`.
- [x] **`parseBlockStyleAttrs`'s asymmetry comment was wrong about the code.**
      Both halves of it said a `PUT` of `lineHeight: 1e9` "is read as absent".
      The band *clamps* a finite out-of-band value to `MAX_LINE_HEIGHT` and
      returns it present; only a non-finite or non-positive multiple is
      dropped. Prose corrected, band unchanged.
- [x] **The row-split test now discriminates.** The one test added with
      `MAX_ROW_PAGE_SPAN` passed unchanged against `origin/main`, so it
      guarded neither line the commit added. Replaced with a row of 500
      pages' worth of height, asserting exactly 200 fragments *and* that they
      still sum to the published row height — verified red (500) with the
      bound reverted.
- [x] `docs.md` said "All six writers route through it" over a parenthetical
      naming seven. Counted in the code: 3 in `text-editor.ts` + the
      `indent`/`outdent` pair in each of `editor.ts` and `text-box-editor.ts`.
- Follow-up, not built here: the DOCX importer is an unaudited *producer* of
  the same bands. `docx-style-map.ts:50` writes `fontSize` straight from
  `<w:sz w:val>` (half-points, so `w:val="99999"` is 49999.5 pt) and `:148`
  writes `lineHeight = lineVal / 240` with no ceiling, so imported content
  above the band is silently reduced by every reader. Auditing and bounding
  an importer is its own change.
- Deferred, unchanged from round 9: `isPaintableImageSize` dropping rather
  than proportionally clamping a legal narrow-and-tall image.
- Not covered on purpose: poisoned-`listLevel` tests for the pdf painter,
  table renderer and peer-cursor paint sinks. One representative sink is
  asserted; the rest share the reader.
