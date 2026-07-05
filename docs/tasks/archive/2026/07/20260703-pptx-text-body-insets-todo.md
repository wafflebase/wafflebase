# PPTX text body insets — center text inside imported boxes/shapes

## Problem

Shared deck slide 13 (`Yorkie 실시간 동시 편집 적용하기.pptx`) renders the
numbers (1–5) inside the right-hand diagram circles shifted to the **top-left**
corner instead of centered.

## Root cause

The number labels are `<p:sp txBox="1">` text boxes overlapping decorative
ellipses. In the source each label's `<a:bodyPr>` sets **symmetric insets**
`lIns=tIns=rIns=bIns=91425` EMU (≈ 19.2 px per side at this deck's scale) with
`anchor="t"` / `algn="l"`. Those large symmetric insets are exactly what
visually centers a single glyph inside the ~56×68 px box.

The PPTX importer **never reads `lIns/tIns/rIns/bIns`** (`src/import/pptx/`
only parses image `fillRect` insets and table-cell `marL/R/T/B`). `TextBody`
has no inset field. So:

- `txBox="1"` → imports as a **TextElement** → renders via `drawText →
  paintTextBody` with **zero inset** → glyph paints at (0,0), the exact
  top-left corner. ← the reported symptom.
- (Shapes with folded `data.text` use a hardcoded `SHAPE_TEXT_PADDING`
  {14.4, 7.2}px, also ignoring the source insets.)

## Fix

Parse `<a:bodyPr>` insets on import and honor them at render time.

- [x] **Model** (`src/model/element.ts`): add `inset?: { left; top; right;
      bottom }` (deck-canvas px) to `TextBody`, documented as `<a:bodyPr
      lIns/tIns/rIns/bIns>`. Absent ⇒ renderer default (unchanged behavior).
- [x] **Import** (`src/import/pptx/text.ts`): `detectBodyInset(txBody, scale)`
      reads the four inset attrs, converts EMU→px via `scale.sx/sy`, fills
      absent sides with OOXML defaults (lIns/rIns=91440, tIns/bIns=45720)
      **only when at least one inset attr is explicitly present** (so empty
      `<a:bodyPr/>` boxes keep current behavior — bounded blast radius).
      Attach in `buildTextBody` (`src/import/pptx/shape.ts`).
- [x] **Render — text elements** (`src/view/canvas/text-renderer.ts`):
      `paintTextBody` inset precedence `opts.inset ?? body.inset ?? padding/0`.
- [x] **Render — shapes** (`src/view/canvas/shape-renderer.ts`):
      `shapeTextInset` takes an optional `pad` override; `paintShapeText`
      passes `data.text.inset` so stored insets compose with the preset rect.
- [x] Editor parity: `buildEditTarget` threads the same inset into the edit
      frame (`shapeTextFrame(kind, frame, inset)` for shapes, new `insetFrame`
      for text elements) so the caret matches the committed paint.

## Tests (TDD — write failing first)

- [x] Import: `txBox="1"` with explicit `bodyPr` insets → TextElement with
      `data.inset` = scaled px (per-side).
- [x] Import: empty `<a:bodyPr/>` → no `inset` stored (unchanged).
- [x] Import: shape (`prstGeom` non-txBox) with explicit insets → `data.text.inset`.
- [x] Render: `shapeTextInset` pad override + preset-rect composition unit tests.

## Verify

- [x] `pnpm test` (slides) green — 2459 pass
- [x] `pnpm verify:fast` — EXIT=0
- [x] Real deck: parsed the actual `slide13.xml`; all 5 circle labels now carry
      an inset ≈ 19.2 px (was absent → painted at top-left).

## Review

Root cause: the `txBox="1"` number labels overlapping the diagram circles rely
on large symmetric `<a:bodyPr>` insets (91425 EMU ≈ 19.2 px/side) to center a
single glyph. The importer never read `lIns/tIns/rIns/bIns`, so text elements
rendered at **zero inset** → glyph pinned to the top-left corner. Fix parses
the insets into `TextBody.inset` and honors them in both the text-element and
shape render paths, guarded to only activate when the source declares an inset
(empty `<a:bodyPr/>` unaffected → bounded blast radius). A self code-review
flagged that the in-place editor would otherwise mount at a different inset than
the committed paint, so `buildEditTarget` now threads the same inset into the
edit frame — caret and glyphs stay consistent on edit entry / commit.
