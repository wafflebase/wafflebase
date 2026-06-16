# Lessons — slides cell/shape text-edit overflow clipping

## Root cause was an asymmetry, not a single broken value

The bug only made sense by comparing two render paths side by side:
the in-place editor (canvas bitmap = box → hard clip) vs the committed
renderer (`paintTextBody` with no `ctx.clip()` → spills to slide edge).
Neither path was "wrong" in isolation; the defect was that they
disagreed. Lesson: for "looks different while editing vs after commit"
bugs, line up the two paint pipelines and diff their clipping/anchoring,
rather than hunting for one bad number.

## Read the layering before resizing a canvas

The fix hinged on a non-obvious fact: the docs `TextEditor` binds its
mouse listeners and all `getBoundingClientRect` math to the **container**,
and uses the **canvas** only for the cosmetic I-beam (`setCanvasCursor`).
That meant the canvas could be enlarged and set `pointer-events: none`
without touching cursor-placement or click-outside-to-commit — the whole
change stayed in the slides wrapper, zero docs edits. Verifying which
element owns which responsibility *before* coding turned a scary
cross-package change into a contained one.

## Match the real clip boundary, not an arbitrary margin

First instinct was a fixed overflow margin, which would just relocate the
same clip. The committed render is bounded by the slide canvas, so the
editing surface should be the slide canvas: a full-slide canvas
positioned over the slide, with the box content shifted to its slide
coordinates (a new default-0 `paintOriginX/Y` on the docs editor). The
two pipelines then clip at the exact same place, so overflow matches in
every direction with no discontinuity at commit. Tie the fix to the
system's actual boundary instead of a guessed margin.

## Don't ship the half-fix you already see the limitation of

The first cut extended the canvas only right/bottom and documented "left/
top overflow stays clipped" as a known limitation. The user hit exactly
that on the next test (middle-anchored cell → top text clipped). A
documented limitation in the same area you're touching is a near-term bug
report waiting to happen — when the complete fix is only marginally more
code (here: one default-0 paint offset), do the complete fix.

## A paint offset beats per-anchor canvas juggling

The tempting slides-only hack was to inflate `contentHeight` and reposition
the canvas per vertical anchor to fake top overflow. That re-derives the
anchor math in a second place and is fragile. Adding one honest
`paintOriginX/Y` to the docs paint — which `paintLayout` already supported
via its `originX/originY` args — kept the anchor math in exactly one place
and made the slides side a pure geometry pass-through.

## Cross-package type dep needs a rebuild

`@wafflebase/slides` typechecks against `@wafflebase/docs`'s built `dist`,
not its source. Editing a docs type and running slides `verify:fast`
fails with a stale-type error until `pnpm --filter @wafflebase/docs build`
runs. `dist` is gitignored (CI rebuilds in dependency order), so nothing
to commit — but locally, rebuild docs before trusting a slides typecheck.

## Same gate, two symptoms

`growMode === 'never'` already meant "fixed box" (shape + cell). Both
share the identical commit-vs-edit clip mismatch, so the principled fix
covered shapes for free — the reported cell bug was one instance of a
class. Relates to [[the shrink fix]] which set cells to `'never'` in the
first place, making this gate include them.
