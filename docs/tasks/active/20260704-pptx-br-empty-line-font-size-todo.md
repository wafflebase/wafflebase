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

## Out of scope (separate fidelity gaps)

- Importer defaults `lineHeight` to docs `1.5` when `<a:lnSpc>` absent
  (PPTX default is 1.0) — inflates all lines uniformly.
- `<a:spcBef>` / `<a:spcAft>` / absolute `spcPts` line spacing unparsed.

These affect all imported text uniformly, not the reported
disproportionate-newline symptom.
