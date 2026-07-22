---
title: docs-ime-composing-underline
target-version: 0.6.2
---

# Docs IME Composing Underline

## Summary

Draw an underline beneath uncommitted (composing) IME text in the docs
editor, and remove it when the composition commits.

While composing text with an IME (e.g. Korean), the docs editor renders the
interim composition glyphs plainly, with no underline. Every native text
field and Google Docs underlines composing text to signal that it is not yet
committed. Wafflebase gives no such visual cue, so the user cannot tell
mid-composition text apart from committed text.

The composing text already lives on a view-local render path (see
[docs-ime-undo-history.md](docs-ime-undo-history.md) and
[docs-intent-preserving-edits.md](docs-intent-preserving-edits.md)): during
composition it is *not* written to the document model, but spliced into the
block's layout as a synthetic inline run by `injectComposingInline`. This note
adds the underline on top of that existing path — the underline is purely a
paint-time decoration of the injected run and never touches the model.

## Background

Issue #342 reports that composing IME text is drawn with no underline. The
issue notes that the fix is cleanest *after* #318, which moved composing text
off the model-drawn path onto a view-local temporary render path. #318 (PR
#332) and the composing-preview wiring (PR #346) have both landed, so the new
render path now exists:

- `TextEditor` tracks the composing string view-locally and publishes it via
  `onComposingContextChange` (`packages/docs/src/view/text-editor.ts`).
- The editor forwards it as a `ComposingContext` into the layout pass
  (`packages/docs/src/view/editor.ts`).
- `injectComposingInline` splices the composing string into the block's
  inlines at the composition offset, inheriting the surrounding *visual* style
  via `composingStyleFrom` (`packages/docs/src/view/layout.ts`).
- The resulting runs are painted by `renderRun`
  (`packages/docs/src/view/paint-layout.ts`), which already knows how to draw
  a per-run underline for `style.underline`.

Because the composing run flows through the normal layout and paint pipeline,
wrapping, following-text reflow, and caret placement are already correct. The
only thing missing is the underline decoration.

## Goals

- Render uncommitted (composing) IME text with an underline.
- Remove the underline automatically when the composition commits or aborts.
- Keep the underline view-local: it is never persisted to the document model
  and produces no Yorkie change or undo unit.
- Cover both the browser IME path and the software-Hangul assembler path
  (both go through `injectComposingInline`).

## Non-Goals

- Underline color / style customization for composing text. The underline is a
  fixed thin solid line in the text color.
- A background highlight or any other composing decoration beyond the
  underline.
- Changing how composing text is measured, wrapped, or committed.
- Any change to the committed-text underline (`style.underline`) behavior.

## Proposal Details

### View-Local `composing` Marker

The marker must NOT live on `InlineStyle` (nor on `Inline`). Both are the
persisted model types (`packages/docs/src/model/types.ts`); adding a field there
— even one documented as view-local — makes it type-reachable from every
document, clipboard, clone, and DOCX/PDF export path, inviting accidental
persistence. Instead the marker lives on `LayoutRun`, the view-only run type in
`packages/docs/src/view/layout.ts` that already carries all other paint-time
state (`x`, `width`, `charOffsets`, `imageHeight`) and is never persisted:

```ts
interface LayoutRun {
  // ...existing fields...

  /**
   * True for runs produced by the IME composing-text injection
   * (`injectComposingInline`). Painted with a composing underline. View-only —
   * lives on the layout run, never on the persisted Inline / InlineStyle.
   */
  composing?: boolean;
}
```

`composingStyleFrom` stays exactly as is (it inherits only visual style and
drops structural metadata like `image` / `pageNumber`); it does **not** gain a
`composing` field. The tagging happens one level up, in the layout pass:

- `injectComposingInline` returns the index of the synthetic inline it spliced
  in (alongside the new inlines array), so callers know which inline is the
  composing preview.
- `layoutBlock` already builds each `LayoutRun` from `inlines[seg.inlineIndex]`.
  When `seg.inlineIndex` is the composing inline's index, it sets
  `composing: true` on the run.

Because `LayoutRun` is discarded and rebuilt on every layout pass and never
crosses into the model, the marker is leak-proof by construction rather than by
convention. Both the browser IME path and the software-Hangul assembler path go
through `injectComposingInline`, so both are covered.

### Painting The Underline

In `renderRun`, after the existing `style.underline` block, draw a composing
underline when `run.composing` is set:

- A thin solid line (1px), in the run's resolved text color.
- Positioned at the same `baselineY + 2` the normal underline uses.
- Reuses the run's already-computed `x` and `width`, so a composing string that
  wraps across lines paints one underline segment per sub-run and the underline
  follows the text across the wrap.

The composing underline is drawn independently of `style.underline`. If the
surrounding text is itself underlined, the composing run inherits that style and
both lines are drawn at the same `y`; they coincide visually, which is
harmless.

### Lifecycle

The underline's lifetime is tied to the composing run's lifetime, which the
existing path already manages:

```text
compositionstart / first jamo
  -> TextEditor publishes composing text via onComposingContextChange
  -> editor sets composingContext, recomputes layout
  -> layoutBlock tags the injected run with composing = true
  -> renderRun paints the composing underline

compositionupdate
  -> new composing text republished; run (and underline) re-laid out

compositionend / commit / abort / blur
  -> composing text committed to the model as a normal inline, or dropped
  -> composingContext cleared -> the synthetic run disappears
  -> the underline is gone on the next paint
```

No explicit teardown is needed: when the composition ends, the committed text
is a normal model inline, laid out into runs with no `composing` flag, and the
synthetic run that carried the underline no longer exists.

## Testing Strategy

### Unit Tests

- `injectComposingInline` returns the index of the spliced composing inline
  (left-biased at an inline boundary, offset-at-end, and empty-block cases).
- `layoutBlock` with a `ComposingContext` tags exactly the composing run(s)
  with `composing: true` and leaves the surrounding runs untagged; when the
  composing text wraps, every sub-run of the composing string is tagged.
- `composingStyleFrom` still inherits visual style and drops `image` /
  `pageNumber`, and does not introduce a `composing` field.
- `renderRun` with a `composing` run strokes a single underline at
  `baselineY + 2` with `lineWidth === 1` and `strokeStyle` equal to the run's
  resolved text color (asserted via a mock canvas context recording
  `moveTo` / `lineTo` / `stroke` and the set properties); a run without the
  flag and without `style.underline` strokes none.

### Lifecycle / Teardown

- After `compositionend` (commit), `compositionabort`, and `blur`, the
  recomputed layout has no run with `composing: true`, so `renderRun` issues no
  composing-underline stroke — assert no further underline draw calls once the
  composing context is cleared.
- A committed inline is a normal model inline: it round-trips through
  serialize / clipboard / DOCX-PDF export with no `composing` field anywhere
  (the field type-only exists on `LayoutRun`, so this is guaranteed by
  construction; a serialization test documents the guarantee).

### Reuse

Extend the existing `packages/docs/test/view/text-box-composing.test.ts`
coverage rather than adding a parallel suite, since it already exercises the
composing-context injection path.

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| The `composing` marker leaks into persisted content, DOCX/PDF export, or clipboard | The marker lives on `LayoutRun` (view-only), not on `Inline` / `InlineStyle`, so it is not type-reachable from any model, clone, serialize, or export path. Leak-proof by construction; a serialization test documents the guarantee |
| Composing over already-underlined text draws a double line | Both lines land at the same `y` and coincide; visually harmless, so no special-casing |
| Underline is left behind if composition ends without clearing the context | The underline is a pure function of the run's presence; when `composingContext` clears, the recomputed layout has no `composing` run and the underline disappears on the next paint. Covered by the lifecycle/teardown tests |
| Software-Hangul assembler path renders without an underline | Both IME and assembler previews go through `injectComposingInline`, so tagging in `layoutBlock` covers both |
