# Sheets: keep the link card open while the pointer is in it — Lessons

## Diagnosis

- The bug is timing dependent, which made the first repro attempts
  disagree. If a `mousemove` lands in the ~2px gap between the cell and the
  card, the engine clears its hover *before* the pointer reaches the card,
  so the later `mouseleave` has nothing to reset and the card stays open.
  Moving straight from the cell into the card skips the gap and always
  closes it. Logging `pointerenter` / `mouseleave` with their order, plus a
  stack on every 250ms `setTimeout`, was what pinned the second `null` on
  `handleScrollContainerMouseLeave`.
- Pointer events fire before the compatibility mouse events, so a
  `pointerenter` handler on an element outside a container always runs
  before that container's `mouseleave`. Any "cancel on enter" scheme has to
  survive a late "leave" from the container it came out of.

## Self review

- Round 1 (correctness and tests, self): no blocking findings on the first,
  host-side version. That review was wrong; see below.

## Review panel

- Round 1 (`@claude review`, 4 blocking, two pairs of duplicates). The first
  version made the host ignore every engine `null` while the pointer was in
  the card. Accepted both points:
  - Too broad: it also swallowed the engine's scroll-time `resetLinkHover`,
    which exists so the card is not re-anchored to a cell that has moved.
  - The "pointer in card" flag stuck when the card unmounted without a
    `pointerleave` (preview opening, loading), disabling auto-close.
- Checking the panel's scroll case in the browser found more than it said:
  once the pointer was in the card, `mouseleave` had already reset the
  engine's hover, so a scroll sent no `null` at all — under the host-side
  rule *and* under a narrower "ignore only the same-task `null`" rule. The
  host cannot fix that; the hover state lives in the engine. So the fix moved
  there: the host marks the card with `LinkCardAttribute`, the engine keeps
  the hover across a leave into the card and re-sends the card when the
  pointer comes back onto the cell. The host-side hook was dropped, and
  `sheet-view.tsx` only gains the attribute.
- Side effect worth keeping: a peer's edit to the hovered cell now refreshes
  or closes the card while the pointer rests in it, because the engine still
  knows the hover (`refreshLinkHoverAfterRender`; exercised by hand after round 3). The first version listed that as a known
  limitation.

- Round 2 (`@claude review`, 2 blocking, one duplicate pair). Accepted:
  keeping the hover across the move into the card left it stale when the
  pointer then went somewhere other than the grid — nothing else re-enters
  the grid to clear it — and a peer's edit to that cell made
  `refreshLinkHoverAfterRender` reopen a card under no pointer. The host now
  calls `Spreadsheet.releaseLinkCardHover()` whenever its card closes; the
  engine forgets the hover only while it is being kept for the card, so a
  card closing while the pointer already waits on another link cell leaves
  that cell's pending card alone. Also took: §4 of the design doc and the
  host comment still described the old unconditional reset;
  `returningFromLinkCard` is now cleared on every leave.
- Not taken from round 2: replacing the DOM attribute with an element the
  host hands the engine (a ref would also work, but the attribute needs no
  lifecycle wiring and the host already renders the wrapper); `instanceof
  Element` instead of duck-typing `closest` (the duck-typed check is what lets
  the node-environment unit tests drive the real handlers).

- Round 3 (`@claude review`, 3 blocking). All accepted, after checking the
  first one by hand:
  - The hand-off only engaged when no `mousemove` sampled the 2px gap
    between the cell and the card. A slow move does sample it, the engine
    lets the hover go on that no-link cell, and the card then stayed open
    with nothing behind it: reproduced with two clients — through the gap, a
    peer's edit left the card listing the old links over the wrong row;
    straight in, it refreshed. Fixed by having the card's `pointerenter`
    hand its cell back (`Spreadsheet.holdLinkCardHover`), which also drops
    another cell's card that was pending on the way.
  - The host half had no test. `sheet-view-link-card.test.tsx` mounts the
    view with a recording engine and covers the attribute, the hold on
    enter, the release on close, and the preview; each case fails with its
    line removed.
  - A revision preview hid the card without releasing the hover. The host
    now closes the card when a preview opens.
  - Also took: the hover teardown that had grown in three places is one
    `forgetLinkHover`; the attribute follows the engine's `data-wb-*` names;
    the design doc no longer cites line numbers that had moved.
- Not taken from round 3: an element reference instead of the attribute
  (same reasons as round 2), and an ownership check on the marked element —
  a page element that claims the attribute only changes when a hover card
  closes, never what a click opens.

- Round 4 (`@claude review`, 2 blocking). Both accepted:
  - The host test asserted the hold on `pointerenter` but not the cancel of
    the pending close, which is the half that keeps the card open after a
    gap move. Added; it fails with the cancel removed.
  - The way back has the same gap: the first move after re-entering the grid
    from the card usually lands on it, which used up the "returning" flag
    with no re-send, so the card closed and reopened 300ms later. The engine
    now keeps the hand-off until a move reaches a link cell, and a close that
    fires first releases the hover.

## Verification

- `pnpm verify:fast` green.
- `pnpm dev`: moving straight from a link cell into the card kept it open
  5 of 5 times (on wafflebase.io before the fix it closed every time);
  scrolling the grid with the pointer resting in the card closed it; moving
  back onto the cell kept it; leaving to an empty cell closed it; clicking a
  link in it opened the link in a new tab. After round 2: moving from the
  card straight out of the grid closed it, and a peer's edit to the cell
  afterwards did not reopen it. After round 3: through the gap, a peer's
  edit to the cell refreshed the card in place.
