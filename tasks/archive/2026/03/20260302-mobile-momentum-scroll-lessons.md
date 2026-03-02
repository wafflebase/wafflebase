# Mobile Momentum Scroll — Lessons

## Velocity Tracking

- Store per-event deltas with timestamps in a rolling buffer of 4 samples.
- When computing average velocity at touchend, skip the first sample's
  delta — it represents movement before the first sample's timestamp, so
  including it overestimates velocity by ~25%.
- Correct formula: sum deltas from index 1..N-1, divide by
  `last.t - first.t`, multiply by 16 to get px-per-frame.

## Inertia Animation

- Exponential decay (`velocity *= 0.95` per frame) gives a natural
  iOS-style feel.
- Adding a max velocity cap (60 px/frame) prevents fast flicks from
  causing jarring visual jumps.
- `requestAnimationFrame` loop stops itself when speed drops below 0.5
  px/frame. No need for a separate timeout.

## Gesture Coexistence

- Inertia only triggers inside the `if (panning)` branch of touchend,
  which returns before double-tap or long-press detection runs — no
  conflict between gestures.
- New touchstart always cancels active inertia immediately, providing
  a responsive stop mechanism.
