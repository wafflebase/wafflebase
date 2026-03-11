# Mobile Momentum (Inertia) Scroll

Add momentum/inertia to one-finger pan gesture so large sheets are easier
to navigate on mobile.

## Context

Current pan gesture in `use-mobile-sheet-gestures.ts` moves the viewport
1:1 with finger movement. When the finger lifts, scrolling stops
immediately. This makes navigating large sheets tedious.

## Tasks

- [x] Track touch velocity during `touchmove` (rolling average of last N samples)
- [x] On `touchend`, if velocity exceeds threshold, start inertia animation
  - Use `requestAnimationFrame` loop with exponential decay (friction ~0.95)
  - Call `spreadsheet.panBy()` each frame with decaying velocity
  - Stop when velocity drops below threshold (~0.5 px/frame)
- [x] Cancel inertia on new `touchstart`
- [x] Tune friction/decay constants for natural feel
- [x] Add maximum velocity cap to prevent jarring jumps
- [x] Ensure no conflict with double-tap detection
- [x] Run `pnpm verify:fast` and confirm pass
