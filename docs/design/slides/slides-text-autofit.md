---
title: slides-text-autofit
target-version: 0.5.0
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# Slides Text Autofit

## Summary

Google Slides and PowerPoint expose **three text-box autofit modes**, and
each box (or the layout slot that owns it) picks one:

| Mode             | Behavior                                              | OOXML           |
| ---------------- | ---------------------------------------------------- | --------------- |
| Do not autofit   | Box fixed; text overflows                            | `<a:noAutofit/>` |
| Shrink on overflow | Box fixed; **font size auto-shrinks** to fit       | `<a:normAutofit fontScale=…/>` |
| Resize to fit text | Font fixed; **box height grows/shrinks** to content | `<a:spAutoFit/>` |

The **grow** behavior ("resize to fit text") already shipped — see
[slides-textbox-autogrow.md](slides-textbox-autogrow.md), which made text
boxes auto-grow their height to content via a docs `onContentHeightChange`
hook, persisted to the frame on commit. That was the single, unconditional
text-box behavior.

This document **layers the remaining two modes on top of auto-grow**:

- A persisted `AutofitMode` field (`'none' | 'shrink' | 'grow'`) that
  selects the behavior per text element.
- **`shrink`** — fonts auto-scale down to fit a fixed box (the user's
  original request: "text size changes with the amount of content"). New.
- The existing auto-grow becomes the **`grow`** mode (and the default for
  absent fields, so existing decks are unchanged).
- Parity defaults: layout **placeholders default to `shrink`** (protect
  the template), free-drawn **text boxes default to `grow`**.
- PPTX `<a:bodyPr>` autofit child mapped on import.

The shrink scale is a **derived value, computed live and never stored**;
each client computes it deterministically from `(blocks, frame, font
metrics)`, so collaborators agree without syncing. Grow continues to
persist `frame.h` on commit (unchanged from the auto-grow feature).

### Goals

- Add `AutofitMode` to `TextElement.data.autofit`; **absent ⇒ `grow`**
  (the pre-autofit default) so existing decks keep auto-growing.
- Implement a shared, deterministic shrink engine reused by the committed
  canvas renderer and the in-place editor (pixel-identical).
- Reuse the existing auto-grow mechanism for `grow`; gate it off for
  `shrink`/`none`.
- Seed parity defaults (placeholder → shrink, text box → grow); map the
  PPTX `<a:bodyPr>` autofit child on import; persist the mode through the
  Yorkie store.

### Non-Goals

- A toolbar / Format-panel mode picker. v1 ships an **in-context
  bottom-left toggle button** on a selected text element (Google-Slides
  parity; see "Mode toggle UI" below) that flips between `grow` and
  `shrink`. `'none'` is reachable via the API / PPTX import only, not
  this button.
- Re-implementing auto-grow — it already exists; this only gates and
  reuses it.
- Vertical text anchoring; `lnSpcReduction`; PPTX export (import only);
  bidirectional "grow text to fill empty space" (shrink scale capped at
  `1.0`).
- Scaling horizontal indents during shrink (see Risks).

## Proposal Details

### Data model

`packages/slides/src/model/element.ts`:

```ts
export type AutofitMode = 'none' | 'shrink' | 'grow';

export type TextElement = ElementBase & {
  type: 'text';
  data: {
    blocks: Block[];
    stroke?: Stroke;
    fill?: ThemeColor;
    /**
     * Autofit behavior. Absent ⇒ 'grow' (the pre-autofit auto-grow
     * default) so existing decks keep growing. Set 'none' explicitly to
     * disable; 'shrink' to scale fonts to a fixed box.
     */
    autofit?: AutofitMode;
  };
};
```

`AutofitMode` is exported from the `@wafflebase/slides` barrel so the
frontend Yorkie schema can reference it.

### Shrink engine

New pure module `packages/slides/src/model/autofit.ts`, built on docs
`computeLayout` (which returns `layout.totalHeight`):

```ts
/** Largest font scale in [FLOOR, 1] whose laid-out height fits the box. */
export function computeAutofitScale(blocks, measurer, frameW, frameH, padding): number;
/** Multiply every inline fontSize + block vertical margin by `scale`. */
export function scaleBlocks(blocks, scale): Block[];
/** Content height for grow callers: totalHeight + 2·padding. */
export function computeAutofitHeight(blocks, measurer, frameW, padding): number;
```

`computeAutofitScale` cannot solve scale analytically (smaller fonts wrap
differently, so height is non-linear in scale): it **binary-searches**
(~8 iterations, floor `0.1`, cap `1.0`), re-laying-out per probe.
`scaleBlocks` preserves block/inline identity (ids, text, counts) so the
editor cursor/selection stay valid against the scaled layout;
`lineHeight` (a ratio) is left unscaled. Renderer text inset is currently
`0`, so callers pass `padding = 0`.

### Committed canvas renderer

`view/canvas/text-renderer.ts` `drawText`: when `data.autofit ===
'shrink'`, compute the scale and lay out `scaleBlocks(...)`. `grow`/`none`/
absent fall through to the existing paint (grow relies on `frame.h`
already equaling content height, written on commit by the auto-grow
feature).

### In-place editor

The editor mounts docs `initializeTextBox`, which already fires
`onContentHeightChange` (grow) and exposes `setContentHeight`. This adds
**one optional docs hook**, `transformLayoutBlocks?: (blocks) => Block[]`,
applied in `recomputeLayout` before `computeLayout` (layout-only, never
written back to the document). Absent ⇒ identity, so the docs
word-processor is unaffected.

The slides wrapper (`view/editor/text-box-editor.ts`) selects behavior by
mode:

| Mode | `onContentHeightChange` (grow) | `transformLayoutBlocks` (shrink) |
| --- | --- | --- |
| `grow` / absent | wired (auto-grow) | — |
| `shrink` | unwired (fixed box) | wired (scale fonts) |
| `none` | unwired (fixed box) | — |

`editor.ts` passes `element.data.autofit` through. Its commit-time height
persist is **automatically gated**: the wrapper only fires
`onContentHeightChange` for grow, so `lastEditingContentHeight` stays
`null` for shrink/none and no `frame.h` write happens.

### Mode toggle UI

A small button is painted at the bottom-left of a selected text
element's frame (Google-Slides parity affordance). Clicking flips the
mode between `'grow'` and `'shrink'`. The host opts in by passing
`OverlayOptions.onAutofitToggle(elementId, nextMode)`; the slides editor
wires that to a `store.batch(() => store.updateElementData(...))` that
patches only `data.autofit`. Renderer / editor wiring already react to
the new mode on the next repaint — no separate re-mount.

- **Visibility:** single text element selected; suppressed automatically
  during in-place editing (the editor filters the editing element out of
  the overlay's `selected` list).
- **From `'none'`:** clicking the button re-enables autofit by switching
  to `'grow'`. `'none'` itself stays API-only (no UI to enter it).
- **Mode-switch geometry:** flipping `grow` → `shrink` keeps the current
  `frame.h` (the box becomes fixed at its current size). `shrink` → `grow`
  re-fits height on the next edit; the renderer paints at `frame.h`
  meanwhile.

### Default seeding & persistence

Creation sites: `model/layout.ts` placeholder → `shrink`;
`view/editor/interactions/insert.ts` inserted box → `grow`;
`import/pptx/shape.ts` → from bodyPr; table cells → omitted (⇒ grow via
absent, matching prior behavior).

Seeding the model init is not enough — the production **Yorkie store**
(`packages/frontend/src/app/slides/yorkie-slides-store.ts`) rebuilds text
`data` in three places that must each carry `autofit` (a bare `{ blocks }`
rebuild drops it): `addElement`, `addSlide` placeholder seeding, and the
undo/redo snapshot restore (which also now carries the previously-dropped
`placeholderRef`). The Yorkie text schema gains `autofit?`. A Mem-vs-
Yorkie equivalence test asserts the field survives all three paths.

### PPTX import

`import/pptx/text.ts` `detectAutofitMode(txBody)` maps the `<a:bodyPr>`
child: `normAutofit`→`shrink`, `spAutoFit`→`grow`, `noAutofit`/absent→
`none`. The existing `normAutofit` fontScale baking is kept (imported
decks render visually identical); the live engine re-engages on edit.

### Risks and Mitigation

- **Shrink algorithm drift vs PowerPoint.** Our binary search won't
  reproduce PowerPoint's exact `fontScale`. *Mitigation:* import keeps the
  baked sizes; the engine only recomputes after a user edit.
- **Determinism.** Shrink scale is a pure function of `(blocks, frame,
  font metrics)`, so all clients agree with nothing persisted.
- **Indents not scaled.** `scaleBlocks` scales font size + vertical
  margins only; `marginLeft` / `textIndent` / list indent stay full-size.
  Applied identically in renderer and editor (no commit jump) — an
  aesthetic v1 limitation, not a correctness bug.
- **Absent ⇒ grow.** Existing decks created under the auto-grow feature
  (no `autofit` field) keep growing; `none` must be set explicitly. This
  preserves the just-shipped behavior rather than silently freezing boxes.
