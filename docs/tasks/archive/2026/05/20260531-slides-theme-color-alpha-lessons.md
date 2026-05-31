# Lessons — ThemeColor alpha modifier

## `<a:alpha>` is universal across color elements

The OOXML alpha modifier (`<a:alpha val>`) can attach to *any* color
element — srgbClr / schemeClr / sysClr / prstClr — not just role
references. Our `applyModifiers` helper was role-only because it
historically handled tint / shade (which are role-only). Refactoring
it to capture `<a:alpha>` for every color kind made the importer
uniformly alpha-aware.

## Avoid spreading `undefined` keys into model objects

Pre-refactor draft did `{ ...base, tint, shade, alpha }` even when one
or more were undefined. Two problems:

1. `expect(parsed).toEqual({ kind: 'role', role: 'accent3', tint: 50000 })`
   — fails when the parsed object also carries an `alpha: undefined`
   key, because `toEqual` checks for shape stability.
2. Some JSON serialization pipelines (`JSON.stringify` strips undefined,
   but Yorkie / structured-clone preserves it) leak the `undefined`
   through as `null`.

Conditional assignment (`if (alpha != null) out.alpha = alpha`) keeps
the model shape clean.

## `alpha === 0` is a real signal, not a "missing" color

PPTX writers use `<a:srgbClr val="9E9E9E"><a:alpha val="0"/>` as the
idiom for "draw nothing here". For cell borders this means: keep
scanning the four sides for one with a real visible color, and skip
the cell border entirely if all four are alpha=0. Conflating alpha=0
with "undefined color" at the wrong layer would either lose the
authored data (importer drops the field) or generate invisible-only
shapes that bloat the model.

## Latent tint/shade unit mismatch — flagged for follow-up

The importer stores tint/shade in raw OOXML units (`0..100000`) but
the renderer's `tintColor` / `shadeColor` treat the value as a
`0..1` ratio. Existing test at `theme.test.ts:43-46` passes because
the test constructs `tint: 0.5` directly; imported tint values
overflow to white/black. Not in scope here — fix needs the renderer
to divide by 100000 OR the importer to normalize. Flagged in this
PR's task doc; a future task should fix and add a round-trip test.

## What was non-obvious

`resolveColor` had to keep returning hex strings on the opaque path
to avoid regressing every color-picker UI that consumes the resolved
string. The fast path (`alpha == null || alpha >= 1`) returns
`#RRGGBB` exactly as before; rgba() only appears for partial alpha.
