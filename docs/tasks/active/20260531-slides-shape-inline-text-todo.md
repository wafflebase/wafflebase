# Slides — inline text inside shapes

## Problem

In Slides today, shapes (`ShapeElement`) cannot hold text. Double-clicking
a shape only drills selection — `editor.ts:1869-1903` ignores the hit
unless `el.type === 'text'`. The workaround is to overlay a separate
`TextElement` on top of the shape, which:

- Diverges from the user mental model carried over from PowerPoint and
  Google Slides, where every autoshape is a text container (double-click
  / Enter / typing all enter text-edit inside the shape).
- Breaks PPTX round-trip fidelity. OOXML `<p:sp>` always pairs a shape
  with `<p:txBody>`; on import we currently drop or split the pair, and
  on export we cannot reconstruct it from an unrelated overlapping
  `TextElement`.
- Forces the user to manually align, group, move, and delete two
  elements that they think of as one.

`docs/design/slides/slides-shapes.md:51-52` explicitly lists
"Shape-internal text" as a non-goal. That decision is what we are
revisiting here.

## Goal

A shape can carry inline text in its `data.text` body, edited via the
same docs text-box editor used for `TextElement`, painted on top of the
shape's fill/stroke. Behavior matches Google Slides / PowerPoint:

- Double-click a selected shape → enter text edit inside the shape.
- Typing a printable character while a shape is selected → enter text
  edit and consume the character (same as Slides/PPT).
- Text body is optional and absent on freshly inserted shapes; the
  first edit lazily initializes an empty block.
- OOXML mapping: `ShapeElement.data.text ↔ <p:sp>/<p:txBody>`.

## Non-goals (for this task)

- Removing `TextElement`. OOXML keeps the "text box" preset distinct
  from a shape with no fill/stroke; we will too. `TextElement` remains
  the canonical text-only primitive.
- Path-clipped text reflow (text wrapping inside arbitrary path
  geometries — chevrons, callouts). v1 lays text inside the shape's
  rotated AABB frame, same way `TextElement` lays inside its frame.
  Logged as a follow-up.
- Per-shape default text styles (e.g. bold body text inside a
  `roundRect`). The first keystroke uses the deck theme's default body
  style, same as `TextElement`.

## Plan

Single PR. Ordering inside the PR keeps each commit `pnpm verify:fast`
green so the branch is bisectable.

### Step 1 — data model + renderer + edit-mode entry

1. **Extract shared `TextBody` type** in
   `packages/slides/src/model/element.ts`:
   ```ts
   type TextBody = {
     blocks: Block[];
     autofit?: AutofitMode;
     verticalAnchor?: VerticalAnchorMode;
   };
   ```
   `TextElement.data` keeps `blocks/autofit/verticalAnchor/stroke/fill`
   structure; we just hoist the three shared fields into the alias for
   reuse in `ShapeElement.data.text?: TextBody`.
2. **`ShapeElement.data.text?: TextBody`** — optional; absent on
   freshly inserted shapes. No migration: existing decks read undefined
   and render as today.
3. **Renderer** — in the slide element painter, after the shape's
   fill/stroke pass, if `data.text?.blocks.length`, run the existing
   `paintLayout` pipeline with the shape's frame as the layout frame.
   Reuse the same `colorResolver` wiring `TextElement` uses (deck
   theme aware).
4. **Edit-mode entry** — in `editor.ts`:
   - `onDoubleClick` (line 1899): allow `el.type === 'shape'` in
     addition to `'text'`.
   - `enterEditMode` (line 1905): when the target is a shape, read
     `el.data.text?.blocks ?? [emptyBlock()]` and the shape's
     `autofit` / `verticalAnchor` analogues. The commit path
     currently calls `store.withTextElement(slideId, elementId, cb)`
     (`packages/slides/src/store/memory.ts:876-890`), which is
     text-element-specific. Add a sibling `store.withShapeText` (or
     widen the existing method) so the Yorkie Tree edits land at
     `element.data.text.blocks` for shapes instead of
     `element.data.blocks`. Same atomicity semantics.
   - If blocks end up empty (no inlines, no text), drop `data.text`
     on commit so empty shapes don't accumulate empty bodies.
5. **Hit / selection** — no change. Hit-test still uses the rotated
   frame AABB; double-click drill-in already drives the right path
   for grouped shapes.
6. **Tests**
   - Model: `addShape` then set `data.text`, render snapshot includes
     the painted text.
   - Editor: double-click on a shape → `editingElementId` becomes the
     shape id; ESC commits and the shape now carries `data.text`.
   - Renderer: shape with text paints fill/stroke under the text.

### Step 2 — type-to-edit (PPT/Slides parity)

7. **Keystroke router** — when a shape (or text element) is selected
   and the keystroke is a printable character (not a shortcut), enter
   edit mode and forward the character to the docs editor as the
   first insertion. Mirrors PPT/GS. Add a unit test for both shape and
   text element.

### Step 3 — PPTX import

The slides package currently has **no PPTX exporter** (only
`importPptx` in `packages/slides/src/index.ts`). Export is a separate
workstream — out of scope here. Step 3 is import-only.

8. **Importer** — in `packages/slides/src/import/pptx/shape.ts:430-441`,
   when a `<p:sp>` has both `prstGeom` and `<p:txBody>`, today it
   emits two layered elements (`ShapeElement` + `TextElement`). Change
   to emit a single `ShapeElement` with `data.text` populated from
   the same `parseTextBody` / `detectAutofitMode` / `detectVerticalAnchor`
   helpers in `packages/slides/src/import/pptx/text.ts`. Keep the
   `txBox` preset path producing a standalone `TextElement` (per
   non-goal — `txBox` is OOXML's text-box-only preset).
9. **Tests** — import a fixture `<p:sp>` with `<p:txBody>` and assert
   the resulting element is one `ShapeElement` with `data.text.blocks`
   populated (not the two-element layered form).

### Step 4 — docs + cleanup

11. **Update `docs/design/slides/slides-shapes.md`**:
    - Remove "Shape-internal text" from the non-goals list.
    - Add a "Shape text body" section describing the `data.text`
      contract, render order, and PPTX mapping.
12. **Cross-link** from `docs/design/slides/slides.md` element table.
13. Optional helper migration note: if any of the seeded layouts ship
    a TextElement-over-Shape pair where the shape is purely
    decorative, consider collapsing into a single shape + text. Not
    blocking; logged as follow-up if any are found.

## Verification

- `pnpm verify:fast` green before each commit.
- `pnpm verify:self` before opening the PR (touches model + renderer
  + PPTX).
- Manual smoke in `pnpm dev`:
  - Insert a `roundRect`, double-click, type "Hello", ESC; reload,
    text persists, paints over the fill.
  - Insert a shape, type "x" while it's selected (no double-click) —
    enters edit and inserts "x".
  - Round-trip via PPTX export → import.
- Two-client smoke: both clients edit the same shape's text via
  Yorkie; no divergence.

## Open questions

- **Default vertical anchor for shape text** — Google Slides uses
  middle for most shapes (rounded rect, ellipse) and top for
  callouts. PPTX preset defaults are per-shape in OOXML. Simplest v1:
  `'middle'` for all closed shapes; revisit if it looks wrong on
  callouts.
- **Default padding** — PPTX `<a:bodyPr lIns/tIns/rIns/bIns>` defaults
  are 91440/45720/91440/45720 EMU (≈0.1"/0.05"). For v1 we can either
  hard-code these or hoist into `TextBody.padding`. Lean toward the
  hard-coded constants until a PPTX file forces non-default values.
