# Slides: Per-deck DPI-aware font scale

**Goal:** Make imported PPTX text render at the same visual proportion
PowerPoint / Google Slides show, without losing the original `pt` value
in the toolbar.

**Symptom (real-world trigger):** The "Yorkie, 캐즘 뛰어넘기.pptx" deck
is `9144000 × 5143500 EMU` (10"×5.625" — the legacy Google-Slides 16:9
size). Our importer scales positions/sizes to 1920×1080, but font sizes
keep the raw pt value. The shared docs renderer's `ptToPx = pt × 96/72`
treats the canvas as 96 DPI, so 52pt renders at 69.3 px on a 1920×1080
canvas (6.4 % of slide height). PowerPoint and Google Slides render it
at 138.7 px on the same proportional slide (12.8 % of height) — roughly
**2× larger**. For the standard 13.333×7.5 widescreen the gap is **1.5×**.

**Architecture:** Record the deck's px-per-pt on `Meta.pxPerPt` at
import. Slides text painters (committed canvas, in-place editor,
placeholder ghost) compute `fontScale = pxPerPt / (96/72)` and apply it
via the existing `scaleBlocks` helper before handing blocks to docs
`computeLayout` / `paintLayout`. Stored `fontSize` stays in physical pt
(toolbar shows 52). Decks without `pxPerPt` (everything authored before
this change) keep the current 96-DPI behavior — no visual regression on
in-flight decks.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `packages/slides/src/model/presentation.ts` | `Meta.pxPerPt`, `DOCS_PX_PER_PT`, `deckFontScale(meta)` helper | Modify |
| `packages/slides/src/import/pptx/slide.ts` (or wherever `sldSz` is read) | Compute `pxPerPt` from `<p:sldSz>` and pass to deck meta | Modify |
| `packages/slides/src/import/pptx/index.ts` | Set `meta.pxPerPt` on the imported doc | Modify |
| `packages/slides/src/view/canvas/text-renderer.ts` | Accept `fontScale` on `drawText` / `paintTextBody`; apply to `drawHint` font size | Modify |
| `packages/slides/src/view/canvas/element-renderer.ts` | Derive scale from `doc.meta` and thread it to the text painters | Modify |
| `packages/slides/src/view/editor/text-box-editor.ts` | Compose `deckScale` into `transformLayoutBlocks` chain | Modify |
| Tests | Cover importer pxPerPt computation + scale at paint/edit | Modify/Add |

---

## Tasks

- [x] **Task 1:** Add `Meta.pxPerPt?: number` and the
  `DOCS_PX_PER_PT = 96 / 72` constant. Expose `deckFontScale(meta)` that
  returns `pxPerPt / DOCS_PX_PER_PT` (or `1` when `pxPerPt` is absent).

- [x] **Task 2:** Compute `pxPerPt = SLIDE_WIDTH × 914400 / (sldSz.cx × 72)`
  in the PPTX importer and stash it on the produced
  `SlidesDocument.meta`. Falls back to `1920 / (DEFAULT_WIDESCREEN_EMU.cx × 72 / 914400)`
  when `<p:sldSz>` is missing.

- [x] **Task 3:** Thread `fontScale` through `text-renderer.ts`:
  - `drawText(ctx, size, data, theme, opts)` gets `fontScale?: number`.
  - `paintTextBody(ctx, size, body, theme, opts)` gets `fontScale?: number`.
  - `drawHint` multiplies `style.fontSize` by `fontScale ?? 1`.
  - When `fontScale != null && fontScale !== 1`, wrap blocks with
    `scaleBlocks(normalized, fontScale)` BEFORE the autofit shrink
    compute so shrink fits the deck-scaled content.

- [x] **Task 4:** In `element-renderer.ts`, compute `deckFontScale(doc.meta)`
  once and pass it to the text painters. (Threads through the
  per-element dispatcher for `shape` / `text`.)

- [x] **Task 5:** In `view/editor/text-box-editor.ts`, compose
  `scaleBlocks(bs, deckScale)` ahead of the shrink-autofit step inside
  `transformLayoutBlocks`. Add `deckFontScale` param to
  `MountSlidesTextBoxOptions` so the editor caller passes the same
  scale the renderer uses.

- [x] **Task 6:** Editor caller (`view/editor/editor.ts`) reads
  `doc.meta` and passes `deckFontScale` into `mountSlidesTextBox`.

- [x] **Task 7:** Tests.
  - `model/presentation.test.ts` (new) or extend an existing one:
    `deckFontScale` returns `1` when `pxPerPt` is absent; returns the
    expected ratio when set.
  - `import/pptx/...` test: a stub PPTX deck with `<p:sldSz cx="9144000" cy="5143500"/>`
    produces `meta.pxPerPt ≈ 2.667` (= `1920 × 914400 / (9144000 × 72)`).
  - `view/canvas/text-renderer.test.ts` (or element-renderer test):
    when `fontScale = 2`, the resulting `ctx.font` reflects a 2×
    enlarged font size for the placeholder hint path; the
    `computeLayout` route paints text taller (height check via spy).

- [x] **Task 8:** Verify.
  - `pnpm verify:fast` green.
  - Manual: re-import the deck and confirm slide 1 title visually
    matches the PowerPoint source.

---

## Notes

- `scaleBlocks` is a pure helper that already preserves block / inline
  identity (id, type, text) — we can apply it idempotently and the
  editor's cursor anchoring against block ids stays valid.
- The toolbar surface reads `inline.style.fontSize` directly; it
  doesn't care about `pxPerPt`. Toolbar continues to show `52` for the
  PPTX-imported title.
- `lineHeight` is a ratio (not pt), so `scaleBlocks` leaves it alone —
  scaled blocks still lay out with the correct line spacing.
- We're not fixing the latent docs-side `ptToPx` issue (the docs canvas
  is implicitly 96 DPI, but for slides the canvas is variable DPI).
  Fixing that properly would require either a per-deck docs theme
  override or a fundamental docs API change. The slides-side
  `scaleBlocks` boundary keeps the docs API untouched.
- Out-of-scope here: backfilling `pxPerPt` on existing in-app authored
  decks. Those decks were created with the implicit 96-DPI conversion
  and look as authored; setting a non-1 `pxPerPt` retroactively would
  visually break user content. The default-undefined fallback is
  intentional.
