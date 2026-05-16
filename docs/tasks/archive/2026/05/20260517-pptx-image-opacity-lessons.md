---
title: PPTX `<a:alphaModFix>` opacity — lessons
date: 2026-05-17
status: complete
---

# Lessons — PPTX `<a:alphaModFix>` image opacity

## What was missing vs. what looked missing

The user reported a missing "blur" on the title-slide background. The
source PPTX had no Gaussian blur at all — the visual effect was a
**19% alpha overlay** (`<a:alphaModFix amt="19000"/>`), not a blur.
Lesson: always inspect the source OOXML before reaching for the named
effect the user described. "looks blurry" maps to several OOXML
primitives (alpha, lumMod/lumOff fade-to-white, real `<a:blur>`); the
fix shape depends on which one.

## OOXML quirk: `alphaModFix` `amt` is thousandths-of-percent

`amt="19000"` reads as 19% — divide by `100_000`, not `1_000` or `100`.
Same convention as `<a:srcRect>` (l/t/r/b), `<a:tint>`, `<a:shade>`,
`lumMod`/`lumOff`. Whenever an OOXML attribute names an `amt` in this
namespace, default to `/ 100_000` unless the spec says otherwise.

## Multi-layer omissions hide behind type elision

The original importer was reading `<a:blip>` and dropping every child
that wasn't `r:embed` or `<a:srcRect>`. There was no warning because:

1. The DOM walker just doesn't see what it doesn't ask for.
2. `ImageElement.data` had no `opacity` field, so even if the importer
   *had* parsed it, there was nowhere to put it.
3. The renderer never set `globalAlpha`, so even if `data.opacity` had
   existed, it would have rendered identically.

Type elision masks each layer's gap from the next. Next time, when
something doesn't import "right," sweep all three layers before
declaring root cause.

## Compose alpha, don't clobber

`ctx.globalAlpha = data.opacity` would *replace* the outer context's
alpha. The slide renderer uses `globalAlpha` for ghost/selection
layers (`slide-renderer.ts:150`), so clobbering it would silently
break those overlays for any image with imported opacity. The fix is
`ctx.globalAlpha = ctx.globalAlpha * data.opacity` — multiply,
guarded by `save`/`restore`. Added a unit test that pre-seeds
`globalAlpha = 0.5`, sets `opacity = 0.5`, and asserts the paint-time
alpha is `0.25` so this invariant can't regress quietly.

## Yorkie schema mirror is its own surface

`ImageElement` (domain) and `YorkieImageElement` (frontend Yorkie
schema mirror) are separate types. JSON round-trip happily carries
unknown fields, but the TS mirror lies until you update it. Code
review caught this — next time, grep `Yorkie<Type>Element` whenever
adding a field to any element `data` shape.

## Design doc state-tracking is load-bearing

`docs/design/slides/slides-themes-layouts-import.md` already had a
faithfulness table row promising `alphaModFix` would land as image
alpha (marked ⚠️). The promise was real; the wiring just wasn't.
Once the wiring landed, the ⚠️ became a lie. Mechanically: when the
behavior in a faithfulness table changes (⚠️ → ✅, ❌ → ⚠️, etc.),
update the row in the same commit. Treat the table as part of the
public contract for import behavior.
