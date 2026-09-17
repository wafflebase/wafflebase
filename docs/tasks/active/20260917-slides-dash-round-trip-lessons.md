# Lessons — close the dash round trip (#1075)

## The exporter is the specification of the importer

`export/pptx/shape.ts` already held the whole vocabulary this branch
needed: `DASH_VAL` maps `dashed → dash` and `dotted → sysDot`. Writing
the importer as the *inverse of that table* (rather than from the OOXML
spec afresh) is what makes the round trip closed by construction — and
it is why the import side is a `Map` for the same reason the export side
is: the key comes from untrusted XML, and an object lookup would resolve
`constructor` off the prototype chain.

The collapse is asymmetric and that is fine: OOXML has ten preset dash
values and the model has three, so import is many-to-one (`lgDash`,
`dashDot`, … all land on `'dashed'`) while export is one-to-one. A
round-trip test therefore proves *our* three survive, not that every
PowerPoint value does.

## A workaround's existence is evidence about the model

`DASH_PREVIEW_MAX_WEIGHT` clamped the dash menu's preview to 3px because
`[2,2]` at 16px reads as a solid bar. That was true — but it was true on
the canvas too, and the menu was the only place anyone had noticed. The
clamp made the picker *lie* in order to stay legible. Scaling the pattern
by the stroke width fixed the underlying model and the workaround
deleted itself.

The honest version is less pretty: at 16px, `Dashed` now previews as one
long dash across a 64px line and is hard to tell from `Solid`. That is
what a 16px dashed border actually looks like, so the menu is no longer
wrong — just no longer flattering.

## Scaling by width was the safe half; scaling by zoom is not

Two separate defects hide behind "the dash pattern is in the wrong
space". Multiplying by `width` is unambiguous and matches PowerPoint.
Dividing by the canvas ctm is *not* obviously right — PowerPoint also
shrinks dashes with zoom, so "dotted looks solid in a 160px thumbnail"
is fidelity, not a bug. Fixing only the first half, and saying so, was
cheaper than deciding the second.

## Keeping `width: 1` output identical bought the change its safety

`dashArray('dotted', 1)` still returns `[2, 2]`. Every stroke the app has
shipped is 1px by default, so the new behaviour is observable only on the
borders that were already broken. Adopting OOXML's literal multiples
(`sysDot` 1:1 ⇒ `[1,1]`) would have been more faithful to the spec and
would have silently restyled every existing dotted border in every deck.
