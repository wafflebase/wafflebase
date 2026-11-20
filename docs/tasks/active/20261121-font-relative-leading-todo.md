# Line spacing is a multiple of the single line, in Docs and Slides

Design docs:
[docs-named-styles.md — Leading is font-relative](../../design/docs/docs-named-styles.md#leading-is-font-relative),
[slides.md — Line spacing is a multiple of PowerPoint's single line](../../design/slides/slides.md#line-spacing-is-a-multiple-of-powerpoints-single-line)
Measurements: [lessons file](20261121-font-relative-leading-lessons.md#step-0-measurements-2026-11-21-chrome-100-zoom-dpr-2)

Text in Docs reads cramped next to the same document in Google Docs or Word,
and Slides text is tighter than Google Slides or PowerPoint at the same
setting. Seen on wafflebase.io in the "Meeting Notes" template: wrapped lines
and consecutive bullets nearly touch.

The cause is `assignLineHeights` (`packages/docs/src/view/layout.ts`), shared
by docs, slides, board and the text-box editor. It sets a line box to
`multiplier × fontSize`, which is CSS's `line-height`. Every product we claim
parity with multiplies a **single line** instead, and step 0 measured what
that single line is:

| Host | Single line (measured) | Our "1.15" today | Theirs |
| --- | --- | --- | --- |
| Google Docs / Word | font-dependent: Arial 1.149 em, Roboto 1.200 em, Nanum Gothic 1.625 em | 1.15 em | Arial ≈ 1.32 em |
| Google Slides / PowerPoint | 1.2 em for every font | 1.15 em | 1.38 em |

We already disagree with ourselves at both file boundaries:
- the DOCX exporter writes `w:line="276" w:lineRule="auto"`, which Word reads
  as 1.15 single lines;
- the PPTX importer multiplies only the *absent* `<a:lnSpc>` case by 1.2
  (`PPTX_SINGLE_LINE_HEIGHT`). An explicit `<a:spcPct val="90000"/>` becomes
  0.9 em instead of 1.08 em, and `Math.max(1, …)` then floors it to 1.0. The
  exporter writes our em value back as a percentage of a single line, so a
  round trip grows every line 1.2×.

## Decisions

- **One engine seam.** `computeLayout` options gain
  `singleLineMetrics(fontFamily) → { above, below }` in em. Absent means
  today's CSS leading, exactly. A line's single height is the tallest `above`
  plus the tallest `below` among its runs, the spacing multiplies it, and the
  extra goes below (`LayoutLine.baseline`). Each host supplies its rule: docs
  a per-font table, slides 1.2 em, board stays on the default.
- **Docs metric:** the browser's normal line height (typo metrics under
  `USE_TYPO_METRICS`, else hhea, line gap included), ×1.3 for CJK fonts, as
  measured over ten families (lessons, second round). The first guess,
  GDI's `max(win, hhea)`, was disproved by Open Sans. Ratios go in a build-time table generated from
  the font files, so the browser, Node pagination, PDF export and slides lint
  agree regardless of web-font load timing. The table has a **measured
  override layer**: Nanum Gothic measures 1.625 in Google Docs and no metric
  in its file explains that, so CJK fonts are measured, not computed. The
  ratio follows the run's *declared* family (measured: Hangul in an Arial run
  keeps Arial's ratio). Unknown families fall back to Arial's ratio.
- **Docs data:** no change, no migration. Stored values already mean "single
  lines", the way DOCX import and export read them; only the renderer was
  wrong. Every docs document reflows once, and that is the fix.
- **Slides data:** today's stored values mean em, and the master placeholder
  styles (title 1.2, body 1.5, subtitle 1.4 …) were tuned for em. Changing the
  ratio alone would grow every existing deck by 20%. So a deck carries a
  marker, `meta.lineSpacing = 'single-line'`:
  - **marked** (new decks, PPTX imports): ratio 1.2, values stored with
    PowerPoint's meaning, picker "1.0" is Google Slides' "Single";
  - **unmarked** (every deck that exists today): ratio 1, which renders the
    deck pixel-identically to today;
  - an existing deck is **converted** by one batch that divides every stored
    `lineHeight` (blocks, table cells, master/layout placeholder styles) by 1.2
    and sets the marker. The conversion is pixel-identical by construction,
    so it can run lazily on open by any editor. A late-arriving old client
    only sees tighter lines until it reloads, and nothing is lost.
- **Glyph placement:** docs follows the measurement. The first baseline is at
  `lineTop + externalLeading + winAscent`, and the extra multiplier leading
  goes below the text. Slides placement is measured in step S0 before it is
  coded.
- **Floor:** `Math.max(1, multiplier)` exists because DOCX `exact`/`atLeast`
  values used to be misread as multipliers. Google Slides ships 0.8 in its own
  default theme, which renders 0.96 em, so the floor moves to the product: the
  line box is never smaller than the font's own pixel height. The DOCX misread
  guard stays in the importer.
- **Board:** out of scope by request. It keeps ratio 1 (unmarked) and is
  untouched. A follow-up issue records it.
- **Out of scope:** the dark-mode page colour (`#2b2b2b`) and the template's
  spell-check squiggle. Both came up in the same review and are tracked as
  separate tasks.

## Rollout: three PRs, each green on its own

### PR 1: engine seam + Docs

- [x] **0. Measure Google Docs.** Arial, Roboto, Nanum Gothic, Hangul fallback,
      glyph placement (see lessons).
- [x] 0b. Measure the remaining CJK families in the curated docs list (filter
      `FONT_CATALOG` by `scripts` ⊇ `korean`/`japanese`/`chinese-*`) in Google
      Docs at 72 pt Single and record them as overrides. Spot-check two more
      Latin fonts (Georgia, Verdana) against the formula.
- [x] `singleLineMetrics` option on `computeLayout` / `assignLineHeights`
      (absent = CSS leading); move the floor to the product.
- [x] Ratio table: a generator script reading the curated + catalog font files
      with fontkit, the override table, a committed generated module in
      `@wafflebase/docs`, and a drift test next to the font catalog's own.
- [x] `DOCS_LAYOUT_OPTIONS.singleLineMetrics = docsSingleLineMetrics`.
- [x] Docs paint path: baseline at `lineTop + externalLeading + ascent`, extra
      leading below. Covers `paintRenderRun`, list markers, underline/strike,
      caret and selection rects, and the PDF exporter's text placement.
- [x] Tests: `assignLineHeights` in both modes, mixed sizes on one line,
      unknown family, a regression test pinning the **measured** Google Docs
      pitches from the lessons file, pagination (fewer lines per page), PDF
      agreeing with `paginateLayout`, and slides/board layouts unchanged.
- [x] `docs-named-styles.md`: the "line box (px)" column with measured values,
      and the status flipped to shipped.

### PR 2: Slides marked decks

- [ ] **S0. Measure Google Slides glyph placement**, the first baseline inside
      a text box at Single and Double, plus Nanum Gothic's single line.
- [ ] `meta.lineSpacing` on the slides model and the Yorkie schema, with a
      store accessor.
- [ ] Slides hosts pass `singleLineMetrics` (1.2 em, placement from S0) when the deck is marked:
      `text-renderer.ts`, `connector-label-layout.ts`, `autofit.ts`,
      `lint/context.ts`, the text-box editor overlay, and table cells.
- [ ] New decks are created marked, with master placeholder styles in
      single-line units (title 1.0, body 1.25, subtitle/caption 1.1667,
      big-number 0.9167 — the em values ÷ 1.2, so a new deck looks the same as
      today's).
- [ ] PPTX import marks the deck: absent `<a:lnSpc>` → 1.0,
      `spcPct` → `val / 100000`. Delete `PPTX_SINGLE_LINE_HEIGHT`.
- [ ] PPTX export: a marked deck writes `lineHeight × 100000`, an unmarked one
      `lineHeight / 1.2 × 100000`.
- [ ] `computeAutofitScale` in single-line units, with a test that a shrink fit
      stays fitted.
- [ ] Tests: a PPTX round trip keeps `lnSpc` exactly (90%, 100%, 150%); an
      unmarked deck lays out identically to `main`; a marked deck matches the
      Google Slides pitch (1.2 em × multiplier).

### PR 3: convert existing decks

- [ ] `convertLineSpacingToSingleLine(store)`: one batch that divides every
      `lineHeight` (body blocks, table cells, group children, master/layout
      placeholder styles) by 1.2 and sets the marker. Idempotent: a marked deck
      is a no-op.
- [ ] Run it lazily when an editor with write access opens an unmarked deck,
      kept out of the undo stack (below the undo floor).
- [ ] Tests: the conversion is pixel-identical (layout before = layout after
      for every fixture deck), idempotent, and safe when two clients convert
      concurrently (both divide → the marker check has to make the second one
      a no-op; prove it with two Yorkie clients).
- [ ] `slides.md` status flipped to shipped.

### Every PR

PR 1 status: goldens regenerated (only the 8 `docs-mixed-font-size-*` images
changed: the shared baseline holds and the text sits about 1 px higher, with
the extra leading now below it); `verify:fast` green; before/after captured in
the docs demo (`packages/docs` `vite`). Known limitation: spell-check squiggles
and comment underlines draw at the line box bottom, so at wide spacing they
sit below the text, as they already did under CSS leading. At the default 1.15
they now clear the descenders, where before they overlapped them.

- [ ] Regenerate the visual goldens (`pnpm verify:browser:docker`) and review
      each changed image by eye.
- [ ] Before → After at 393×659 for every editor the PR touches, plus a
      desktop pair beside the Google Docs/Slides measurement shot.
- [ ] `pnpm verify:fast`; manual smoke in `pnpm dev`: typing, caret,
      selection, lists, tables, headers/footers, page breaks, autofit, PDF,
      DOCX and PPTX export opened in Word/PowerPoint.
- [ ] `/self-review` per the project workflow.

## Risks

- **Every docs document repaginates**, by about 15% for Arial and much more
  for a document set in a CJK font (Nanum Gothic ≈ 1.4× today). This is the
  intended fix; call it out in the release notes.
- **CJK overrides drift:** a CJK font added to the catalog without a
  measurement silently gets its computed ratio, which for Nanum Gothic would be
  wrong by about 50%. The generator fails when a font with a CJK subset has no
  override entry.
- **Slides version skew:** between deploy and reload, an old client renders a
  converted or marked deck in em units (about 17% tighter). Nothing is lost,
  and the effect ends at reload.
- **Conversion race:** two editors converting at once must not divide twice.
  PR 3's concurrency test is the guard. If the marker can't serialize it,
  convert on the server through the v1 Yorkie service instead.
