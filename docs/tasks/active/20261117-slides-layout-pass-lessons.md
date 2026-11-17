# Slides editor layout pass — lessons

## Check a review finding against the design docs before dispatching it

The layout review flagged the right-cluster panel toggles changing from
labels (idle) to icons (object / text edit) as an inconsistency, and the
toolbar agent removed the labels. That form change is a documented
decision (`slides-toolbar-redesign.md` § Labelled chrome): the labels
follow Google, whose Background / Theme row is a no-selection
affordance, and fall back to icons only when the strip is too narrow.

Rule: before turning a review observation into an agent task, grep the
subsystem's design doc for the behavior. "Looks inconsistent" is a
hypothesis; a doc that names the behavior and its reason outranks it.

## Parallel agents in one checkout

Five agents edited disjoint file sets in the same working tree with no
git operations of their own, which avoided per-worktree installs. It
held: no file collisions. The shared cost was noise — each agent saw the
same 155 frontend `tsc` errors and could not tell them from another
agent's in-flight edit. They came from running `tsc -p tsconfig.app.json`
directly; `pnpm verify:fast` (the real gate) was green. Point agents at
the package's own typecheck script, not a hand-picked tsconfig.

## Self-review log

- Round 1 (correctness / test adequacy): 2 blocking, both on
  `toolbar-overflow.tsx` — `flushSync` called from observer callbacks
  could be refused and leave folded DOM and the More button out of step;
  `data-text-edit-keepalive` untested. Fixed both: More's visibility is
  now written in the same DOM pass as the fold markers (no `flushSync`),
  and keepalive gets tests.
- Round 2 (design fit / blast radius + `requesting-code-review`): panel
  blocked on blast-radius — the More popover carried
  `data-canvas-toolbar`, so the out-of-diff focus-release hook (#882)
  pulled focus out of the popover on a click inside it and dismissed the
  menu. Reproduced with a failing test against the real hook, then
  removed the marker (the trigger is still in the canvas toolbar, so
  closing the menu returns the keyboard to the canvas). The reviewer
  agent found no critical/important issues; fixed its three wording
  findings (overflow JSDoc + design doc overstated shared state, sidebar
  hook claimed the cookie never changes, stale `store.ts` comment).
  Deferred as known limitations: per-frame `getComputedStyle` in the
  ruler, rotate buttons using `title` rather than `Tooltip`, a refold
  hiding a focused control, duplicate accessible names while More is open.

Lesson: a marker attribute is a contract with every hook that reads it.
Before putting `data-canvas-toolbar` (or any opt-in marker) on a new
surface, read its consumers — here the marker meant "release focus from
me", which is wrong for a popover that must keep focus to stay open.

- Round 3 (security / docs / design-doc consistency) — the bound. 3
  blocking: (a) design-fit: ruler and Format panel now share a unit label
  but use different scales — ruler 144 px/in (13.333" page, matching PDF
  and PPTX export), panel 192 px/in (10" page, Google Slides). Real and
  pre-existing, but this branch made it more misleading (same label,
  different numbers). The two design docs (`slides-ruler.md` vs
  `slides-format-options-panel.md`) each commit to a different scale, so
  picking one is a product decision: deferred to the PR for a human.
  (b, c) test-adequacy: added tests for the More menu staying open while
  a folded picker's portalled popup is used, and for keyboard vs click
  open focus. Mutation check: the keyboard test fails without the
  `onOpenAutoFocus` branch; the portal test passes even with the
  `onInteractOutside` guard removed (Radix resolves nested layers through
  React context), so the guard looks redundant — kept as defensive and
  flagged in the PR. Loop stopped at the bound, not on a clean round.

Lesson: making two displays agree on a *label* can surface that they
disagree on the *quantity*. When unifying units, check the conversion
constants of every surface that shows the unit, not just the unit flag.

