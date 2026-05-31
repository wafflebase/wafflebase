# Lessons — Per-deck DPI font scale + horizontal indent

## Docs `ptToPx` is implicitly 96 DPI — a slides assumption broke it

`packages/docs/src/view/theme.ts:139` hardcodes `pt × 96/72`. That's
correct for the docs canvas (8.5×11" @ 96 DPI = 816×1056 px). Slides
has a 1920×1080 canvas representing a *variable* physical deck size
— a 13.333" widescreen = 144 DPI, a 10" widescreen (Google Slides'
historical default) = 192 DPI. Same pt value → different visual
proportions on different decks. The fix is the slides side because
the docs API stays pristine.

## Yorkie persistence needs BOTH write and read fixes

First-round implementation only added `meta.pxPerPt` to the model
and importer. User re-imported → reported "no change". Two more
sites were silently dropping the field:

1. **Write path** (`slides-view.tsx:172-183`) — re-built `r.meta`
   field-by-field, losing every optional key on the imported `Meta`.
   Fix: `r.meta = { ...pending.meta }`.
2. **Read path** (`migrateDocument` at `model/migrate.ts:13-21`)
   — only forwarded `title/themeId/masterId/unit`. Fix: forward
   `pxPerPt` with defensive `Number.isFinite` + `> 0` guard.

Any future optional `Meta` field will hit the same trap unless the
write path stays as a spread and `migrateDocument` is updated.

## scaleBlocks must scale ALL proportional fields

The deck-DPI fix reuses the existing `scaleBlocks` helper (also used
by autofit shrink). `scaleBlocks` was only scaling fontSize,
marker.fontSize, marginTop, marginBottom — *not* marginLeft and
textIndent. Symptom (slide 2): bullet hang indent stays at 1× while
fonts scale to 2×, halving the bullet → text gap. Adding marginLeft
and textIndent to the scaler also incidentally improved shrink
autofit (smaller body text gets proportionally smaller indent).

Lesson: when scaling a typographic frame, every proportional field
must scale together. `lineHeight` is a ratio (intentionally not
scaled); margins / indents are absolute pixels and must scale.

## Pre-scale-blocks boundary keeps docs API untouched

Three alternatives considered:
1. Mutate font sizes at import (toolbar shows wrong pt).
2. Inject DPI override into docs theme (large docs API change).
3. **Pre-scale blocks at the slides ↔ docs boundary** (chosen).

#3 wins because: stored fontSize stays as physical pt (toolbar
shows 52), docs API stays as-is (no docs-side feature for slides),
and the scale propagates correctly through autofit because
`computeAutofitScale` consumes already-pre-scaled blocks.

## What was non-obvious

The editor's `transformLayoutBlocks` chain needs to compose
deckScale BEFORE shrink autofit. Order matters: shrink fits the box
based on what will be painted, so the input to shrink must already
be the visually-correct (deck-scaled) text. Same composition runs
in `paintTextBody` and `mountSlidesTextBox` to keep editor-canvas
pixel-identical to the committed paint.

## Backward compatibility

Pre-existing in-app authored decks omit `pxPerPt` →
`deckFontScale` returns 1 → bit-for-bit identical render. The
guard is intentional: backfilling pxPerPt retroactively would
visually shrink content users wrote against the current
(implicitly-96-DPI) rendering.
