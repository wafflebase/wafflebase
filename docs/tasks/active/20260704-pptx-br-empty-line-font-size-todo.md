# PPTX `<a:br>` / blank-line font size — todo

## Problem

Imported PPTX text boxes drop `<a:br>` newlines and blank lines "too far
down". Repro: `Yorkie_ 실시간 동시 편집 적용하기.pptx`, roadmap slide
(slide31), "v0.3: SaaS 오픈" box — all body text is 8pt but the line
breaks render ~37% too tall.

## Root cause

`packages/slides/src/import/pptx/text.ts`:

- `<a:br>` was lifted to `{ text: '\n', style: {} }` — dropping the
  `<a:rPr sz>` it carries.
- Blank paragraphs (`<a:p/>` or `<a:r><a:t/></a:r>` + `<a:endParaRPr>`)
  got a `{ text: '', style: {} }` placeholder — never reading
  `<a:endParaRPr>`.

Downstream, `docs` `getLineMaxFontSizePx` (layout.ts) falls back to
`Theme.defaultFontSize` (11pt) for any run without `fontSize`, and
`assignLineHeights` multiplies that by lineHeight. A `\n` run at 11pt
also inflates the *preceding* content line (`max(8, 11) = 11`).

## Fix

- [x] Extract `parseRunStyle(rPr, fontScale, ctx)` from `parseRun`.
- [x] `<a:br>` → `parseRunStyle(child(el,'rPr'), …)` on the `\n` inline.
- [x] Blank paragraph (no visible-text inline) → collapse to one
      placeholder sized from `<a:endParaRPr>`; covers bare `<a:p/>` and
      empty `<a:t/>` runs.
- [x] Unit tests: br carries size, empty `<a:p>` from endParaRPr, empty
      `<a:t/>` run collapse.
- [x] Verified end-to-end against the real deck (all blank/newline
      inlines in the roadmap box now carry 8pt, no `undefined`).

## Follow-up: paragraph spacing (same box, second report)

After the font-size fix the gap between "v0.3: SaaS 오픈" and
"더 쉽고 빠른…" (which sandwich the empty paragraph) was still too wide.
Measured the box's blocks: every block carried `lineHeight=1.5` and
`marginBottom=8` — docs *word-processor* defaults inherited from
`DEFAULT_BLOCK_STYLE`, even though the source sets `spcBef=0`/`spcAft=0`
and no `<a:lnSpc>` (PPTX default is single spacing, zero para gap).

- [x] Reset imported paragraph spacing to PPTX defaults: `lineHeight 1.2`
      (PowerPoint "single" ≈ 1.2×, folds in the font's leading; 1.0 packs
      body text too tight), `marginTop/marginBottom 0` (was 1.5 / 0 / 8).
- [x] Parse `<a:spcBef>`/`<a:spcAft>` `spcPts` → `marginTop`/`marginBottom`
      (points × 96/72 → px); honors an explicit `spcAft="0"`.
- [x] Export inverse: emit `<a:spcBef>`/`<a:spcAft>` from margins (OOXML
      order lnSpc → spcBef → spcAft) so round-trip holds.
- [x] Tests: default single-spacing/zero-margin, spcBef/spcAft mapping,
      explicit-zero, export emission + omission; round-trip suite green.
- [x] Verified on the real deck: blocks now `lineHeight=1`, `mBot=0` on
      the v0.3 line + blank line, `mBot=21.3px` (=16pt spcAft) on the
      bullet paragraph.

## Still out of scope

- `<a:lnSpc>` absolute `spcPts` line spacing (docs lineHeight is a ratio).
- `<a:spcBef>`/`<a:spcAft>` percent-of-line (`spcPct`) form (rare).
