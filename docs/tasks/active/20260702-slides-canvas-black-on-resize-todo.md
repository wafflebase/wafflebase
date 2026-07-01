# Slides canvas goes black on global sidebar toggle

## Problem

Toggling the global app sidebar intermittently leaves the slides editor
canvas fully black (blank) until an unrelated event repaints it.

## Root cause (verified by reading the code)

`refitCanvas` in `packages/frontend/src/app/slides/slides-view.tsx`
(707–842):

- **Guard (809):** `if (sameSlide && sameCanvas) return;` — only skips
  when both the fitted-slide size AND the pasteboard-canvas size are
  unchanged.
- **Unconditional clear (816–817):** assigning `canvas.width` /
  `canvas.height` resets the backing store to transparent every time we
  pass the guard.
- **Conditional redraw (830, 832):** the redraw after the clear is
  delegated to `editor.setHostSize` and `editor.setSlideOffset`
  (`packages/slides/src/view/editor/editor.ts:1452`, `1466`), each of
  which **early-returns without `markDirty()`** when its inputs are
  unchanged.

Failure combo: `sameSlide === true` (fitted slide size unchanged — common
at Fit zoom when height-constrained or `MAX_HOST_W`-clamped) while
`sameCanvas === false` (pasteboard width changed). Then the bitmap is
cleared, `setHostSize` early-returns (host unchanged), and `setSlideOffset`
also early-returns when the centered offset happens to be unchanged
(`Math.floor` absorbs small deltas). Nobody calls `markDirty()`, so the
rAF `tick()` (1055–1068) no-ops and the cleared canvas stays black.

The 200ms sidebar width CSS transition fires the `ResizeObserver`
(848–849) many times; whether the settle frame lands on the
host-invariant + offset-invariant combo determines whether it goes black —
hence "intermittent".

## Fix

Force exactly one repaint after the destructive resize **only** on the
frame where nothing else repaints: canvas size changed, but host size and
offset both unchanged. Single paint in every case (no double-paint on
host-change frames, no perf regression), fixes the blank-canvas frame.

Extract the non-obvious condition into a named, documented, tested
predicate `needsForcedRepaintAfterRefit`.

## Tasks

- [x] Add `refit-repaint.ts` helper with `needsForcedRepaintAfterRefit`
- [x] Wire it into `refitCanvas` (compute the 3 change flags before the
      offset reassignment; force repaint when the predicate is true)
- [x] Unit test the predicate incl. the exact bug case (failing-first)
- [x] `pnpm verify:fast`
- [ ] Manual smoke in `pnpm dev`: Fit zoom + toggle sidebar repeatedly
- [x] Self review over branch diff (code-reviewer subagent)
- [ ] PR

## Review

Code-reviewer subagent verdict: **merge with (non-blocking) fixes**. No
Critical/Important correctness issues. Confirmed:

- Predicate fires on exactly the frames where both `setHostSize` and
  `setSlideOffset` no-op → single paint, no double-paint, no perf
  regression during the sidebar transition.
- `offsetChanged` captured before the offset reassignment (correct).
- CSS↔logical offset equivalence holds because the forced repaint is
  skipped when the host is unchanged (scale invariant).
- `markDirty()` + `render()` matches the existing store-change path.

Applied from review:
- Added the CSS↔logical equivalence rationale as a comment at the
  `setSlideOffset` call site.
- Documented the call-site test-coverage gap in the lessons file (the
  `refitCanvas` closure is not cheaply unit-testable; predicate is
  extracted + tested, wiring verified by manual smoke).

Latent follow-up (out of scope): `dpr` captured once at mount can diverge
from the engine's `options.dpr` across monitors — separate task.
