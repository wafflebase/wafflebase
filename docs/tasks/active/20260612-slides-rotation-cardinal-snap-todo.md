# Slides rotation: cardinal soft-snap

## Problem

In `packages/slides/src/view/editor/interactions/rotate.ts`, free rotate
(no Shift) has no snap — so when the user drags a shape back toward 0°
they easily leave a tiny non-zero angle (e.g. 0.005 rad ≈ 0.3°). The
tooltip rounds the displayed degree (`Math.round(deg)`) so it reads
"0°", but the stored `Frame.rotation` is non-zero and the shape renders
slightly crooked.

The editor callsite at `packages/slides/src/view/editor/editor.ts:5169`
also always passes `startRotation = 0`, so even for a single element the
function snaps a *delta*, not the absolute final rotation. That makes
the Shift 15° snap subtly wrong for shapes that already had a non-zero
rotation (drag-snap targets are the delta + 0, not the absolute).

## Reference behavior

- **Google Slides** — free drag soft-snaps at 0°/90°/180°/270° within
  ~±3°, drawing a horizontal/vertical guide while it sticks. Shift
  snaps to 15°.
- **PowerPoint** — free drag is truly free (same "crooked at 0°"
  artifact), users correct via the Format pane.

We match Google Slides.

## Proposal

1. Add `snapToCardinal(angle, tolerance)` in `rotate.ts`. Snaps to the
   nearest multiple of π/2 when within `tolerance` radians; otherwise
   returns the input unchanged. Default tolerance `π / 60` (3°).
2. `applyRotate` calls `snapToCardinal(next)` in the free-drag branch.
   Shift branch unchanged (`snapAngle`, 15° step).
3. `editor.ts:5169` passes the actual `entries[0].startRotation` for
   single-element rotate and unwraps the returned absolute rotation
   into `liveDelta = result - startRotation`. Multi keeps `startRotation = 0`
   (delta semantics — group rotate-gesture snap).

This way the snap target is the *final absolute rotation* of the shape
in the single case, and the *delta of the group gesture* in the multi
case — both match Google Slides.

No format-panel changes: `RotationInput` in
`packages/frontend/src/app/slides/format-panel/size-position-section.tsx:296`
already commits exact degrees via `degToRad(n)`.

## Behavior changes (intended)

- Free drag near 0/90/180/270° (within 3°) sticks to the cardinal.
- Shift drag on a shape with non-zero initial rotation now snaps the
  absolute rotation to 15° steps (previously snapped delta).

Tradeoff: exact "2° tilt via drag" is no longer possible — use the
format panel. Matches GS.

## Plan

- [ ] Extend `rotate.ts` with `snapToCardinal` + free-drag soft snap
- [ ] Update `editor.ts` callsite to pass `startRotation` for single
- [ ] Add unit tests covering near-cardinal snap, mid-range pass-through,
      Shift unchanged
- [ ] `pnpm verify:fast`
