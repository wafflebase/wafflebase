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
same clip. The committed render is bounded by the slide canvas, so
extending the editing surface to `SLIDE_WIDTH/HEIGHT - frame.origin`
makes the two pipelines clip at the same place — no discontinuity at
commit. Tie the fix to the system's actual boundary.

## Same gate, two symptoms

`growMode === 'never'` already meant "fixed box" (shape + cell). Both
share the identical commit-vs-edit clip mismatch, so the principled fix
covered shapes for free — the reported cell bug was one instance of a
class. Relates to [[the shrink fix]] which set cells to `'never'` in the
first place, making this gate include them.
