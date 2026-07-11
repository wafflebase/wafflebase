# PPTX import: inherit paragraph alignment from the placeholder style chain

## Problem

When importing a `.pptx`, a placeholder title that is centered in the
source renders **left-aligned** in Wafflebase.

Root cause: the importer reads `<a:pPr algn>` only from the **slide
paragraph's own** properties (`text.ts` `parseParagraphProperties`). It
never resolves alignment inherited through the OOXML placeholder style
chain:

```
slide paragraph <a:pPr algn>          (checked today)
  → layout placeholder <a:lstStyle><a:lvl1pPr algn>   (ignored)
  → master <p:txStyles> <p:titleStyle|bodyStyle|otherStyle> <a:lvl1pPr algn>  (ignored)
```

Repro deck: `260708_Naver_HQ_발표자료_draft2_KR.pptx`, slide 3.
Its title paragraph has no `algn`; the center comes from
`slideLayout4.xml`'s title placeholder `<a:lstStyle><a:lvl1pPr algn="ctr">`.

The importer already resolves **font size** from the layout placeholder
`lstStyle` (`placeholderSizes`) and **bullet markers** from master
`txStyles` (`txStylesMarkers`) — alignment simply wasn't carried along
either path.

## Plan

- [x] `text.ts`: extract `mapAlgn(algn)` → `BlockStyle['alignment']|undefined`;
      add `defaultAlignment?` to `TextParseContext`; apply it when the
      paragraph (and even a missing `<a:pPr>`) carries no explicit `algn`.
- [x] `layout.ts`: parse `placeholderAlignments` (layout placeholder
      `lstStyle`→`lvl1pPr algn`), keyed by `"{type}:{idx}"`, mirroring
      `placeholderSizes`. Thread through `ImportedLayout`.
- [x] `master.ts`: parse `txStylesAlignments` (per `TxStylesSlot`, from
      `lvl1pPr algn`), mirroring `txStylesMarkers`. Thread through
      `ImportedMaster`.
- [x] `slide.ts` / `index.ts` / `shape.ts`: thread both maps into
      `SlideParseContext`; in `buildTextBody`, resolve
      `defaultAlignment = layoutAlign ?? masterTxStylesAlign(slot)` and
      pass it to `parseTextBody`.
- [x] Tests: import unit test (layout-inherited + master-txStyles-inherited
      centered title, and explicit slide `algn` still wins).
- [x] `pnpm verify:fast` — green (EXIT 0).

## Verification

- Unit: 3 new `text.test.ts` cases (inherit when no `algn`; inherit when
  `<a:pPr>` present but no `algn`; own `algn` overrides), 1 `layout.test.ts`,
  2 `master.test.ts`. All green.
- End-to-end (throwaway test, since removed): imported the real
  `260708_Naver_HQ_발표자료_draft2_KR.pptx` via `importPptx`; slide 3's
  title element (`placeholderRef.type === 'title'`) now imports with
  `blocks[0].style.alignment === 'center'` (was left/unset before). Root
  cause confirmed: center lives on `slideLayout4.xml`'s title placeholder
  `<a:lstStyle><a:lvl1pPr algn="ctr">`; the slide paragraph carries no `algn`.

## Code review (high effort) — dispositions

- **Per-level alignment (correctness)** — fixed: apply the inherited default
  only to level-0 paragraphs (the level we resolve from `lvl1pPr`); deeper
  bullets keep their left default. Regression test added.
- **Secondary-master txStylesAlignments dropped (correctness)** — accepted as
  a known limitation: `txStylesMarkers` and `clrMap` are *also* threaded from
  the primary master to every slide (index.ts:126 comment: "the first master
  is the primary: its color map, txStyles, and background drive the deck").
  Per-slide master resolution is a separate refactor spanning all three; out
  of scope here.
- **Duplicated placeholder walk / triple spTree traversal (cleanup)** — fixed:
  `eachPlaceholderLvl1` shared helper; size + alignment parsers now share one
  traversal + discovery rule. (Frame parse stays separate — gated on `bgCtx`.)
- **Doubled `placeholderTypeToTxStylesSlot` call (cleanup)** — fixed: hoisted
  to a single `txStylesSlot` const.
- **"Parallel maps vs unified record" (refuted by verifier)** — no change;
  mirrors the existing `placeholderSizes`/`txStylesMarkers` shape.

## Non-goals

- Master **placeholder** `<a:lstStyle>` (rarely populated; the importer
  reads nothing else from it). Per-outline-level default alignment (only
  `lvl1` is resolved, matching `defaultFontSize`).
