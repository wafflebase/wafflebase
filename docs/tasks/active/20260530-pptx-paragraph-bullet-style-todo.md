# Task: Import PPTX paragraph-level bullet style (buFont / buSzPts / buClr)

## Problem

In a deck imported from PowerPoint, list-item bullet markers render at
inconsistent sizes/fonts inside a single text box. For the Yorkie
"캐즘 뛰어넘기" deck slide 2, the first three bullets render with a
visibly smaller black `●` while the fourth bullet renders with a
visibly larger orange `●`, even though every paragraph in the source
declares the same marker size (`<a:buSzPts val="1800"/>` = 18 pt) and
the master declares `<a:buFont typeface="Arial"/>`.

Root cause: `parseParagraphProperties` in
`packages/slides/src/import/pptx/text.ts` reads only `lnSpc`, `marL`,
`indent`, `lvl`, `buAutoNum`, and `buChar` — it drops `<a:buFont>`,
`<a:buSzPts>`, and `<a:buClr>` entirely. Downstream `renderListMarker`
in `packages/docs/src/view/paint-layout.ts` falls back to
`block.inlines[0].style.{fontSize,fontFamily,color}`, so marker glyphs
inherit whichever font Wafflebase happened to assign to the paragraph's
first run. The PPTX-importer Korean-Hangul fallback only fires on runs
whose own text contains Hangul, so bullets 1–3 (English prefix
"April, 2019: ") keep `fontFamily = undefined → Arial` while bullet 4
("Oct, 2022: Yorkie, 캐즘 뛰어넘기") gets `fontFamily = "Noto Sans KR"`.
Arial's `●` glyph is ~7.7 px tall vs. Noto Sans KR's ~16.2 px at the
same 18 pt — hence the visible mismatch.

PowerPoint and Google Slides render the marker through the paragraph's
own bullet properties, independent of the run font, so all four
bullets look identical apart from color.

## Goal

Read paragraph-level bullet style (`<a:buFont>`, `<a:buSzPts>`,
`<a:buClr>`) during PPTX import and feed it through to the marker
painter, so imported decks render markers exactly as authored.

## Approach

1. **Data model (`packages/docs/src/model/types.ts`)**
   - Add an optional `Block.marker?: BlockMarker` field.
   - `BlockMarker = { fontFamily?: string; fontSize?: number; color?: StoredColor }`.
   - Export the type from `packages/docs/src/index.ts`.

2. **Renderer (`packages/docs/src/view/paint-layout.ts`)**
   - `renderListMarker` reads `block.marker?.{fontFamily,fontSize,color}`
     in preference to `inlines[0]`.
   - When `marker` is absent, behavior is identical to today.

3. **Importer (`packages/slides/src/import/pptx/text.ts`)**
   - In `parseParagraphProperties`, parse `<a:buFont typeface=…>`,
     `<a:buSzPts val=…>`, and `<a:buClr>…</a:buClr>` into a `BlockMarker`.
   - Plumb the marker through `parseParagraph` → `Block.marker`.
   - Honor `ctx.clrMap` for scheme colors inside `<a:buClr>`.
   - Skip on `buAutoNum` paragraphs only if a glyph-specific font would
     mis-render the numeric marker — defer; both buChar and buAutoNum
     paragraphs can carry buFont/buSzPts/buClr in real decks.

4. **Tests**
   - Slides import: assert that a paragraph carrying
     `<a:buFont typeface="Arial"/>`, `<a:buSzPts val="1800"/>`,
     `<a:buClr><a:srgbClr val="FF9900"/></a:buClr>` produces a
     `Block.marker` with the expected values.
   - Docs renderer: assert that `renderListMarker` uses `block.marker`
     when present, falling back to `inlines[0]` otherwise.

5. **Out of scope**
   - `<a:buSzPct>` percentage marker size (none of the benchmark decks
     use it; left as a follow-up if needed).
   - Layout/master-level bullet style inheritance — the benchmark
     deck inlines bullet props per paragraph, so per-slide reads
     cover the visible regression. Inheritance is a separate
     v1.5/v2 surface.

## Checklist

- [x] Add `BlockMarker` type and `Block.marker?` field.
- [x] Export `BlockMarker` from `@wafflebase/docs`.
- [x] Update `renderListMarker` to prefer `block.marker`.
- [x] Parse `buFont`/`buSzPts`/`buClr` in `parseParagraphProperties`
      (accept slide-parse context so scheme colors resolve through `clrMap`).
- [x] Set `Block.marker` in `parseParagraph` when parser returns one.
- [x] Add slides import test for paragraph bullet style.
- [x] Add docs renderer test for marker style preference.
- [x] `pnpm verify:fast` green.

## Re-import note

Existing Yorkie documents imported with the previous code don't carry
`Block.marker` and continue to render markers through the
`inlines[0]` fallback — i.e. the bug is still visible on already-imported
decks. Re-importing the PPTX (or a future migration that backfills the
marker field from the source) is required to recover the authored
markers for old documents. New imports get correct markers automatically.
