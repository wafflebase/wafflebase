# Mobile Momentum (Inertia) Scroll

Add momentum/inertia to one-finger pan gesture so large sheets are easier
to navigate on mobile.

## Context

Current pan gesture in `use-mobile-sheet-gestures.ts` moves the viewport
1:1 with finger movement. When the finger lifts, scrolling stops
immediately. This makes navigating large sheets tedious.

## Tasks

- [ ] Track touch velocity during `touchmove` (rolling average of last N samples)
- [ ] On `touchend`, if velocity exceeds threshold, start inertia animation
  - Use `requestAnimationFrame` loop with exponential decay (friction ~0.95)
  - Call `spreadsheet.panBy()` each frame with decaying velocity
  - Stop when velocity drops below threshold (~0.5 px/frame)
- [ ] Cancel inertia on new `touchstart`
- [ ] Tune friction/decay constants for natural feel
- [ ] Ensure no conflict with double-tap detection
- [ ] Run `pnpm verify:fast` and confirm pass
