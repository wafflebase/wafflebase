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

## Measurement found what reading could not

The third round ran a headless Chromium harness over the real built CSS
instead of reasoning about selectors, and it found two things no amount
of reading would have:

- `min-w-11` on a flex item replaces `min-width: auto` — i.e. min-content
  — which is what made these toolbars *overflow* rather than compress.
  Adding a floor took a floor away.
- The fix for that, `shrink-0`, then broke the mobile bars in the
  opposite direction, because their right-pinned controls hang off a
  `flex-1` spacer that collapses to zero the moment the row overflows.

Both were invisible in the diff and obvious in a measurement. The same
harness also caught that narrowing an exclusion to `min-w-` disarmed
every `Toggle` — the most common control in those strips — which is the
kind of second-order damage a "safer" fix does quietly.

**Rule:** when a change is expressed in CSS, verify it in a browser. The
emitted stylesheet is not the question; the computed box is.

## Two guards are not one guard

`isPrimary` on `pointerdown` stops a second finger *starting* a gesture.
It does nothing about the one already running, because the drag loops
listen on `document` and filter nothing. Both halves were needed, and
shipping the first read as "multi-touch handled".

The second half is one capture-phase listener rather than a `pointerId`
check in sixteen loops — worth noting as a shape: when a cross-cutting
rule has to hold in many places, putting it *upstream of all of them* is
both smaller and safer than putting it in each, because a future loop
cannot forget to opt in.

## A fix in one layer can starve another layer's bookkeeping

The worst defect on this branch was not in the original work. It was
created by a fix: the editor's foreign-pointer guard stops a second
touch's `pointerup` at `document` capture, and the board's gesture layer
listened on `container` — downstream in the capture phase — so it never
saw that release. The pointer stayed in its `active` set, and since a
board gesture ends only when that set drains, one two-finger press on an
element left the board unable to pan for the life of the mount.

Nothing about either piece is wrong in isolation. The damage lives in
the *ordering* between two components that never mention each other,
and it took a reviewer walking the propagation path end to end to find
it. The fix — bind on `window`, which the capture phase reaches before
`document` — is three lines, and unfindable without that walk.

**Rule:** stopping an event is not a local act. When one layer suppresses
events, enumerate every other layer that listens for the same event and
ask what it now fails to learn. "Who else is downstream of me" is a
question with an answer, and it is worth writing down at the point of
suppression.

## Prove a regression test is not vacuous

Three tests on this branch were checked by reverting the fix and
confirming the test failed. One of them was nearly worthless before that
check: it dispatched its probe event on `document`, which only the fixed
binding could receive, so it would have passed for the wrong reason and
kept passing if the fix were undone in a different way. Moving the
dispatch to the element made the test isolate the actual defect.

**Rule:** a regression test that has never been seen to fail is a
hypothesis, not a test. Reverting the fix takes a minute and is the only
thing that distinguishes the two.

## What the review was worth

Three rounds — five parallel reviewers over the branch diff, two more
over the fixes, then CodeRabbit on the PR — surfaced 21 real defects.
None of the rounds was redundant: the second found defects *in the first
round's fixes*, and the third found two that the first two missed
entirely (the board long-press leaving its gesture live, and the
presenter navigating on a pinch).

The most valuable lenses were the ones with no access to the author's
reasoning: the git-history reviewer, which found the drill-out
regression by reading the commit that fixed it for the mouse; the
cross-surface reviewer, which found the toolbar damage by enumerating
consumers of a shared component and then measuring them; and CodeRabbit,
which asked the plain question "what happens after the menu opens" that
the author had answered for slides and never asked again for board.
