# Slides: Honor `<a:alpha>` modifier on imported colors

**Goal:** Preserve OOXML color alpha through the slides pipeline so fully
transparent (`<a:alpha val="0"/>`) and partially transparent colors
render correctly. Concrete trigger: slide 33 of the "Yorkie, 캐즘
뛰어넘기.pptx" deck has cell borders defined as `#9E9E9E` with
`<a:alpha val="0"/>` — PowerPoint shows no borders, but we currently
import the color at full opacity and paint a solid gray grid.

**Architecture:**
- Add `alpha?: number` (range `0..1`, `undefined` ⇒ fully opaque) to both
  variants of `ThemeColor` so the field can ride along with either an
  sRGB value or a role reference.
- `resolveColor` emits `rgba(R, G, B, A)` only when alpha is partial; the
  fully-opaque path keeps returning the current hex string so no
  downstream picker code regresses.
- The PPTX importer's `applyModifiers` becomes generic — it inspects
  `<a:alpha>` (and the existing `<a:tint>` / `<a:shade>`) once and
  attaches them to the parsed `ThemeColor`. All four color kinds
  (`srgbClr`, `schemeClr`, `sysClr`, `prstClr`) get alpha applied
  uniformly.
- Table import: `buildCellBorder` already returns `undefined` when no
  visible border color exists. Treat `alpha === 0` the same way so we
  don't create invisible-only stroke shapes that bloat the data model
  and clutter selection bboxes.

**Out of scope:** The existing tint/shade ratio mismatch (importer stores
OOXML int units `0..100000`, renderer treats it as `0..1`) is a separate
latent bug — keep the existing renderer convention (`0..1`) and divide
the OOXML int in the importer for `alpha` only.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `packages/slides/src/model/theme.ts` | `ThemeColor.alpha`, `resolveColor` rgba output | Modify |
| `packages/slides/src/import/pptx/color.ts` | Parse `<a:alpha>` for all color kinds | Modify |
| `packages/slides/src/import/pptx/table.ts` | Skip alpha=0 borders in `buildCellBorder` | Modify |
| `packages/slides/test/model/theme.test.ts` | Cover rgba output for alpha | Modify |
| `packages/slides/test/import/pptx/color.test.ts` | Cover alpha parsing | Modify |
| `packages/slides/test/import/pptx/table.test.ts` | Cover alpha=0 border-skip behavior | Modify |

---

## Tasks

- [x] **Task 1:** Add `alpha?: number` to `ThemeColor` and update
  `resolveColor`.
  - Range: `0..1`, undefined ⇒ fully opaque.
  - When alpha is `undefined` or `>= 1`, output stays as today
    (`#RRGGBB`).
  - When alpha is partial, output `rgba(R, G, B, A)` with `A` clamped to
    `[0, 1]`.
  - Tint/shade pre-applied first; rgba conversion happens after.

- [x] **Task 2:** Refactor `applyModifiers` in
  `packages/slides/src/import/pptx/color.ts` so it works on both srgb
  and role variants, and pick up `<a:alpha>`.
  - Convert OOXML units (`0..100000`) to `0..1` by dividing by
    100000.
  - Apply to `srgbClr`, `schemeClr`, `sysClr`, `prstClr` (the wrapper
    color elements; alpha is a child of these, not of the container).
  - Preserve current tint/shade behavior on role colors.

- [x] **Task 3:** Update `buildCellBorder` in
  `packages/slides/src/import/pptx/table.ts` to skip a border whose
  color has `alpha === 0`.
  - The existing per-side loop continues to the next side when a side
    has no color; treat alpha=0 the same way.
  - `tableBordersApproximated` is bumped only when a real visible color
    is found — current behavior preserved.

- [x] **Task 4:** Tests.
  - `theme.test.ts`: alpha=0 → `rgba(R, G, B, 0)`, alpha=0.5 →
    `rgba(R, G, B, 0.5)`, alpha undefined → hex (regression guard).
  - `color.test.ts`: alpha on srgbClr / schemeClr / sysClr / prstClr;
    alpha clamps to `0..1`; absence stays absent (no `alpha` key).
  - `table.test.ts`: cell with all four sides alpha=0 → no border shape
    emitted; cell with one visible side + three alpha=0 sides → the
    visible one wins.

- [x] **Task 5:** Verify.
  - `pnpm verify:fast` green.
  - Manual: re-import the deck and confirm slide 33 tables render
    without the gray grid.

---

## Notes

- ThemeColor is stored as JSON inside Yorkie documents. Adding an
  optional field is backward compatible — pre-alpha documents continue
  to render as fully opaque (the renderer reads `alpha` as `undefined`).
- Toolbar color pickers (`shape-controls.tsx`, `border-picker.tsx`,
  etc.) consume the resolved CSS string. They will display partial-alpha
  colors fine (browsers accept `rgba()` as a CSS color) but won't yet
  let the user author alpha. That UI is a separate follow-up.
- A latent bug exists in `tint` / `shade`: the importer stores them in
  OOXML int units (e.g. 50000) while the renderer's tint/shade helpers
  treat the value as a 0..1 ratio. Decks that import with non-zero tint
  via PPTX currently render as oversaturated to white/black. Out of
  scope here — flagged for a follow-up task.
