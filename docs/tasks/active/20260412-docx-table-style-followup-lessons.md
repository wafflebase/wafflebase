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

## Verification gap

Canvas paint is not unit-testable in jsdom (`getContext` unimplemented);
the project verifies rendering via `pnpm verify:browser:docker`. A paint
regression like this passes every jsdom unit test. For render-path changes,
the real gate is the browser/visual test or a manual smoke — `verify:fast`
green is necessary but not sufficient.
