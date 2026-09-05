# Slides & Board touch input — lessons

## A threshold that is read in the wrong place fixes nothing

The defect was "a tap nudges the element it lands on and pushes an undo
entry". The obvious fix — raise `DRAG_THRESHOLD_PX` for touch, since a
fingertip reports 5–10px of travel across a press the user held still —
was written, tested, documented, and did **not** work. The threshold fed
only the snap corrections. The move commit keys on `liveDx`/`liveDy`,
assigned on every move with no threshold at all; the two resize commits
key on nothing and write `live.worldFrame` unconditionally.

The unit tests passed, because they tested the pure function. The design
doc asserted the defect was fixed, because the author asserted it. Both
were honest and both were wrong.

**Rule:** when a change is justified by a defect, trace the value from
where it is *set* to where the defect actually happens, and put a test
on that path — not on the helper. "I raised the constant" is not
evidence; "the element does not move" is.

## The thing a claim leans on is the thing to verify

Three separate comments written in this pass asserted a mechanism that
turned out not to exist:

- `armLongPress`: "that drag has moved less than the tolerance, so its
  `onUp` commits nothing — it takes the zero-delta path". The zero-delta
  path requires *exactly* zero.
- `hasContentAt`: "the host has no access to the selection scope a group
  drill-in establishes". True, but irrelevant — the boolean is
  scope-independent. The real reason is the hit context and transform.
- `Toolbar`: "every control inside grows to a 44px floor". The selector
  was `[&_button]`; the font-size picker's target is an `<input>`.

Each read as a *reason*, which is what made them convincing. A reason
that is load-bearing for a design decision has to be checked like an
assertion, not written like a rationale.

## `PointerEventInit.isPrimary` defaults to false

An `isPrimary`-only multi-touch guard broke 57 tests instantly, which
was the good outcome — a guard that silently rejects every synthetic
`PointerEvent` would be a slow, confusing failure in a codebase where
the interaction suite is built entirely out of them. Scoping the guard
to `pointerType === 'touch'` is both narrower and more honest about what
the rule is for.

## A capture-phase `stopPropagation` on a container is wider than it looks

The board's gesture layer claims presses in the capture phase on
`container`. That halts the event before it reaches descendants **and**
before it bubbles back to `document`. Two things broke that the claim
was never aimed at: the minimap (a child of the same container, with its
own bubble-phase drag) and the context menu's outside-press dismissal
(a `document` listener). Neither is visible from the gesture code.

**Rule:** before claiming events on a container, enumerate what else
lives under it and what listens above it. "Which element" and "which
phase" are two different questions and both have to be answered.

## Ownership decided at press time has to be re-decided at gesture end

The first version tracked only the pointers it owned, so a conceded
press (a finger on an element) left the map empty — and a second finger
landing on blank canvas read as a *fresh* gesture and panned the plane
out from under an element drag. A test caught it. The fix is a second
set holding every touch that is down, owned or not, so a gesture is over
only when that set drains.

## Viewport units and `window.innerHeight` are different heights

`calc(100vh - 32px)` for a cap and `window.innerHeight` for the clamp
that positions the same element disagree by the height of the mobile URL
bar — on exactly the platform the cap was added for. Two measurements of
"the screen" in one function must come from one source.

## Fixed-height containers do not grow to fit a floor

`min-h` applied to descendants is safe only where the ancestor can grow.
The mobile slides toolbar pins `h-10`, and `overflow-x-auto` makes
`overflow-y` compute to `auto`, so 44px buttons inside a 40px strip are
*clipped* — the one surface guaranteed to be on a coarse pointer got
worse targets, not better. A blanket descendant rule needs a survey of
every consumer, and the survey is what the review found.

## What the review was worth

Five parallel reviewers over the branch diff found 4 real defects the
author's own testing had not (minimap, menu dismissal, teardown leak,
presenter flag latch), plus the threshold error above and the toolbar
regressions. The two most valuable lenses were the ones with no access
to the author's reasoning: the git-history reviewer, which found the
drill-out regression by reading the commit that fixed it for the mouse,
and the cross-surface reviewer, which found the toolbar clipping by
enumerating consumers of a shared component.
