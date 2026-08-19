// THE DRAG GESTURE, in one place so the driver and its verification cannot disagree.
//
// ITS OWN MODULE for the reason `hunt-ui-dom.mjs` is: `hunt-ui-runner.mjs` parses argv and
// exits at import time, so the oracle lane cannot import the dispatch it needs to check.
// The alternative is for the lane to reimplement press-move-release, and a lane that
// exercises a COPY of the mechanics proves only that the copy works — the two then drift,
// and the drift shows up as a defect report about the product.

/** How many intermediate moves a drag makes.
 *
 * FIXED, and deliberately not a caller knob. Measured against the real slides editor: 1, 5
 * and 25 steps produce byte-identical results, because the engine tracks `pointermove`
 * deltas rather than integrating a path. So the parameter buys nothing and costs something —
 * an exposed number is a number a caller will predict about, and a plan that behaved
 * differently at 5 than at 25 would be a replay hazard rather than a finding.
 *
 * 10 rather than 1 anyway: a single jump is the shape most likely to break the day some
 * interaction starts caring about intermediate positions, and the cost is nil.
 */
export const DRAG_STEPS = 10;

/**
 * Press at `from`, move to `to`, release.
 *
 * Points are viewport coordinates — resolving a target to a point is the caller's job, and
 * keeping it out of here is what lets the oracle lane drive the same gesture without
 * importing the runner's argv parsing.
 */
export async function performDrag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: DRAG_STEPS });
  await page.mouse.up();
}
