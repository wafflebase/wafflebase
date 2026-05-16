# TODO — PPTX import: honor table cell margins

**Created**: 2026-05-16
**Parent**: `20260507-slides-themes-layouts-import-lessons.md` audit finding

## Problem

`packages/slides/src/import/pptx/table.ts:78-89` builds the per-cell
`TextElement.frame` as the full `cellFrame` (column width × row
height). PPTX defaults to ~91440 EMU L/R and 45720 EMU T/B cell margins
(`<a:tcPr marL marR marT marB>`), so a right-aligned label in column N
and a left-aligned value in column N+1 visually touch at the shared
border.

Benchmark deck (`/shared/17025f9e-cd3f-4793-91e3-593cd899e3fe`) shows
the regression on:

- slides 24, 25, 26, 27 — 전파/저장 grid renders as "저장 XMemory"
- slides 33, 34, 35 — credits table renders as "Yorkie 개발hackerwins"

## Fix

In `packages/slides/src/import/pptx/table.ts`:

1. Parse `<a:tcPr>` `marL`/`marR`/`marT`/`marB` attributes (EMU
   integers); fall back to ECMA-376 defaults
   (`marL=marR=91440`, `marT=marB=45720`).
2. Inset the `TextElement.frame` by these margins (border rect keeps the
   full cellFrame). Use `ctx.scale` to convert EMU → px.

## Steps

- [x] Step 1 — `table.ts`: add `parseCellMargins(cell)` helper returning
      `{ marL, marR, marT, marB }` in EMU with defaults.
- [x] Step 2 — Apply margins to text frame in `parseTable`:
      `frame.x += marL*sx; frame.w -= (marL+marR)*sx; frame.y += marT*sy; frame.h -= (marT+marB)*sy`.
- [x] Step 3 — Unit test: cell with explicit
      `marL/R/T/B` shifts text frame; cell without `tcPr` uses defaults.
- [x] Step 4 — Unit test: text frame width is `cellWidth - (marL+marR)`
      px (default case).
- [x] Step 5 — `pnpm verify:fast` (787 slides + 143 backend + frontend
      green).
- [x] Step 6 — Manual smoke: re-imported benchmark `.pptx` via a
      one-off node script. Slide 24 "저장 X" cell text (x=1033, w=145
      → right edge 1178) now sits 38 px clear of the "Memory" cell text
      (x=1216). Slide 33 "Yorkie 개발" (right edge 1187) leaves 39 px
      before "hackerwins" (x=1226). Before the fix the texts touched at
      the shared border.
- [ ] Step 7 — Commit + push, open PR.

## Out of scope

- Per-side border strokes (still uses dominant-side approximation).
- True cell merge (`gridSpan`/`rowSpan`) layout — same as PR2.

## Risks

| Risk | Mitigation |
|---|---|
| `<a:tcPr>` parsing already lives partially in `buildCellBorder`; risk of duplication | Add a tiny helper, call from both. |
| Default margins differ from what PowerPoint actually uses | ECMA-376 spec defaults are the safe baseline; users can override per cell. |

## Review

- `packages/slides/src/import/pptx/table.ts` adds `parseCellMargins`
  (ECMA-376 defaults 91440/91440/45720/45720 EMU) and insets the per-cell
  `TextElement.frame` by the parsed margins; the cell border rect keeps
  the full outer frame. 1 file changed, ~30 lines added.
- `packages/slides/test/import/pptx/table.test.ts`: existing positioning
  assertion updated to expect the default insets; new test covers
  explicit `marL/R/T/B` values.
- `pnpm verify:fast` green (787 slides + 143 backend + frontend tests
  pass).
- Smoke: benchmark deck slides 24 + 33 show 38-39 px gap between
  adjacent right-aligned / left-aligned cells; before the fix the texts
  touched at the column border.

Known limitations (deliberate — out of scope here):

- Per-side border strokes still use the dominant-side approximation
  (separate finding in PR2).
- `<a:gridSpan>` / `<a:rowSpan>` true merge is still counted but not
  rendered.
