# DOCX table style & exporter follow-up — lessons

## Item 6: a feature spans more layers than the import path

**Symptom:** after wiring `parseHeaderFooter` to import `<w:tbl>`, the
manual smoke test showed only paragraphs — the header table was invisible.

**Root cause (found via systematic boundary tracing, not guessing):**
the bug was three layers downstream of the change. Evidence gathered at
each boundary:

1. **Importer** — ran the real importer on the fixture: produced
   `header.blocks = [table(2 rows), paragraph]`. ✓ correct.
2. **Yorkie write+read** — round-tripped a header table through a *fresh*
   `YorkieDocStore` (no cache): read back `['table','paragraph']`. ✓.
3. **Layout** — `computeLayout` is shared with the body; a header table
   block gets a `layoutTable`. ✓.
4. **Paint** — `DocCanvas` header/footer loop only iterated
   `lb.lines → line.runs`. A table `LayoutBlock` has `lines:[{runs:[]}]`
   (empty) plus `layoutTable`, so it painted **nothing**. ✗ root cause.

**Lesson:** "support X in header/footer" is not done when import produces
X. Trace the value all the way to the pixel: import → store round-trip →
layout → **paint**. Each is a separate boundary that can silently drop the
feature. The header/footer paint path was a hand-rolled text-only loop, a
parallel implementation of the body's renderer — a classic spot for a
feature to fall through.

**Lesson:** when code-reading says "this should work" but the user sees it
fail, stop reading and gather empirical evidence at each boundary (run the
real importer on the real file; round-trip through the real store). Three
quick experiments localized the bug faster than re-reading the render path.

**Altitude note:** the header/footer paint loop duplicated the body's
block iteration but without table support. The fix extracted
`renderHeaderFooterBlocks` and routed tables through the *shared*
`renderTableBackgrounds`/`renderTableContent`. Prefer converging on the
shared renderer over adding a second text-only path.

## A new editable region inherits the whole editing surface

**Symptom (2nd smoke):** clicking a header that contains a table and typing
threw `Cannot read properties of undefined (reading 'text')` in
`resolveOffset` (block-helpers.ts:29) — and the uncaught error in
`handleInput` broke editing everywhere, not just the header.

**Root cause:** a `table` block has `inlines: []`. The header/footer
hit-test (`getHFPositionFromMouse`) had no table-cell resolution (unlike the
body's `resolveTableCellClick` + `resolveOffsetInCellAtXY`), so a click on a
header table returned the *table* block id. Typing → `resolveOffset(table)` →
`inlines[-1].text` → crash.

**Lesson:** enabling a block type in a *new region* silently opts that region
into the entire editing surface — hit-test, caret (`computeHFCursorPixel`),
selection, arrow-nav, text mutation. The body wires all of these for tables;
the header/footer region wired none. "It renders" ≠ "it's a first-class
editable block." Enumerate the editing surface (click → caret → type → delete
→ split → navigate) and either wire each or guard each.

**Lesson (defense placement):** guarding only the crash line (`resolveOffset`)
is insufficient — the next caller (`applyInsertText`, or the Yorkie tree path)
would deref `inlines[0]` or insert an inline node into the table's tree node
and *corrupt* it. The correct guard is the invariant at the data layer:
`insertText`/`deleteText` early-return on `block.type === 'table'`, so any
stray caret (click, edit-entry, arrow-key) is a safe no-op regardless of how
it got there.

**Scope decision:** full header/footer table cell editing (cell caret +
selection + navigation) is a separate, larger feature. This pass keeps header
tables render-faithful and crash-safe, and redirects header-table clicks to
the nearest editable paragraph. Documented as a known limitation.

## Arrow keys "jumped" out of header cells — a shared map built body-only

**Symptom:** mouse click/type/select in a header table cell worked, but any
arrow key snapped the caret to the table block (the first header block).

**Two wrong theories, killed by evidence before fixing:**
- *Caret math wrong?* Proved consistent: the renderer draws cell text at
  `tableX + columnXOffsets[col] + padding + run.x`; the caret pixel uses the
  same formula. Mouse and arrow render identically for the same position.
- *Hidden textarea auto-scroll?* The textarea is `position: fixed`, so it
  never triggers container scroll. (The cursor-pixel context-fix is still a
  correctness improvement for IME placement, but it was not this bug.)

**Root cause (found by reproducing in a jsdom test, not by reading):** a
`handleKeyDown` guard resets the caret to the first context block when
`doc.findBlock(caret.blockId)` returns undefined (meant for blocks deleted by
a remote peer). `findBlock` → `findBlockInCells` keys off `doc._blockParentMap`,
which the editor populated from the **body** layout only
(`doc.setBlockParentMap(bodyLayout.blockParentMap)`). Header/footer table
cells were never registered, so a header-cell caret looked "deleted" → reset.
Typing survived only because it flows through the `input` event, not
`keydown`.

**Fix:** merge the header and footer layouts' `blockParentMap` into the doc's
map each layout pass.

**Lessons:**
- A keydown handler and an input handler are *different code paths*. "Typing
  works" does not imply "all keys work" — arrows/backspace/enter go through
  keydown and can hit guards that input bypasses.
- When you add a region (header/footer) that reuses body machinery, audit
  every place the body registers global state (`setBlockParentMap`,
  caret/selection maps). One body-only registration silently breaks the new
  region's keyboard path while leaving mouse + typing intact.
- Stop theorizing after two falsified hypotheses — *reproduce*. A ~40-line
  jsdom test (canvas shim + `initialize` + `_setEditContextForTest` +
  dispatch `keydown`) localized this in one run after a lot of dead-end
  reading. The minimal test-only helpers were worth adding.

## Verification gap

Canvas paint is not unit-testable in jsdom (`getContext` unimplemented);
the project verifies rendering via `pnpm verify:browser:docker`. A paint
regression like this passes every jsdom unit test. For render-path changes,
the real gate is the browser/visual test or a manual smoke — `verify:fast`
green is necessary but not sufficient.
