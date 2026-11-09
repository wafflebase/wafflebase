# Sheet Presence Jumps — Lessons

## Diagnosis

- The fastest signal came from the live document, not from screenshots:
  finding the Yorkie `Document` through the React fiber tree, subscribing to
  `presence`, and resolving each peer's presence exactly as `overlay.ts`
  does every 50 ms turned "the cursors wobble" into a log of concrete
  transitions (`A5 → A1`, `HIDDEN(anchor-miss)` after a tab switch).
- Lining up two clocks by interval rather than absolute time was enough to
  tie a row delete to an A1 jump: two deletes 6,565 ms apart, two jumps
  6,543 ms apart.
- Reproducing in a fresh sheet needed axis coverage in mind: a cell past
  `rowOrder` / `colOrder` publishes no anchor, so it neither snaps on delete
  nor goes stale on a tab switch. The first attempt at each case picked such
  a cell and looked like a non-repro.

## Out of scope

- Some clients delivered presence in ~1 s bursts. The receiver pulled
  promptly and the server batches at 100 ms, so it is sender-side; the SDK's
  sync loop is a `setTimeout(…, 50)` chain, which a throttled tab runs at
  1 Hz. Not reproduced: the browser automation keeps its tabs visible.
