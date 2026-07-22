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

Add an optional, view-local `composing` flag to `InlineStyle`:

```ts
interface InlineStyle {
  // ...existing fields...

  /**
   * View-local marker set only by `composingStyleFrom` while an IME
   * composition is in progress. Runs carrying it are painted with an IME
   * composing underline. Never persisted to the document model.
   */
  composing?: boolean;
}
```

`InlineStyle` is the persisted model style type, but this flag is only ever set
on the synthetic inline that `injectComposingInline` builds for the composing
preview — which lives entirely inside the layout pass and is never written back
to Yorkie. The flag is documented as view-local so no persistence or
import/export path picks it up.

`composingStyleFrom` (which already strips structural metadata like `image` and
`pageNumber` from the inherited style) sets `composing: true` on the style it
returns. Both the browser IME path and the software-Hangul assembler path build
their preview through `injectComposingInline`, so both are covered by this one
change.

### Painting The Underline

In `renderRun`, after the existing `style.underline` block, draw a composing
underline when `style.composing` is set:

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
  -> injectComposingInline splices a run with style.composing = true
  -> renderRun paints the composing underline

compositionupdate
  -> new composing text republished; run (and underline) re-laid out

compositionend / commit / abort / blur
  -> composing text committed to the model (no `composing` flag) or dropped
  -> composingContext cleared -> the synthetic run disappears
  -> the underline is gone on the next paint
```

No explicit teardown is needed: when the composition ends, the committed text
is a normal model inline with no `composing` flag, and the synthetic run that
carried the underline no longer exists.

## Testing Strategy

### Unit Tests

- `injectComposingInline` output: the spliced composing run's style has
  `composing: true`, and the surrounding (non-composing) runs do not.
- `composingStyleFrom` sets `composing: true` while still dropping `image` and
  `pageNumber`.
- `renderRun` with a `composing` run strokes an underline (asserted via a mock
  canvas context recording `moveTo` / `lineTo` / `stroke` at `baselineY + 2`);
  a run without the flag and without `style.underline` strokes none.
- A committed inline (no `composing` flag) is painted without a composing
  underline.

### Reuse

Extend the existing `packages/docs/test/view/text-box-composing.test.ts`
coverage rather than adding a parallel suite, since it already exercises the
composing-context injection path.

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| The `composing` flag leaks into persisted content, DOCX/PDF export, or clipboard | The flag is only set by `composingStyleFrom` on the view-local injected run, which is never written to the model; documented as view-local. Add a test asserting committed text has no `composing` flag |
| Composing over already-underlined text draws a double line | Both lines land at the same `y` and coincide; visually harmless, so no special-casing |
| Underline is left behind if composition ends without clearing the context | The underline is a pure function of the run's presence; when `composingContext` clears, the run and its underline disappear on the next paint. No separate teardown to get wrong |
| Software-Hangul assembler path renders without an underline | Both IME and assembler previews go through `injectComposingInline` / `composingStyleFrom`, so the single marker covers both |
