# Sheets: keep the link card open while the pointer is in it (#1124)

Design doc: [sheet-hyperlink.md §5 — The hover card](../../design/sheets/sheet-hyperlink.md#5-the-hover-card)

Moving the pointer from a link cell into its hover card closed the card about
250ms later, with the pointer resting inside it. A click aimed at a link in
the card then landed on the grid cell underneath: the cell got selected and
the link did not open. Whether it happened depended on whether a `mousemove`
landed in the ~2px gap between the cell and the card first, so a normal mouse
movement often hit it.

The card is outside the grid's scroll container. Entering it fires, in order:
the card's `pointerenter` (cancels the pending close), then the scroll
container's `mouseleave` → `handleScrollContainerMouseLeave` →
`resetLinkHover` → `onLinkHover(null)` → `scheduleLinkHoverClose`, which
re-arms the close after it was cancelled.

## Tasks

- [x] `LinkCardAttribute` (`data-wb-link-card`): the host marks the card's
      wrapper with it
- [x] `handleScrollContainerMouseLeave` keeps the hover when the pointer
      leaves into the card
- [x] `handleScrollContainerMouseEnter`: back from the card onto the same cell
      re-sends the card; from anywhere else, forget a stale hover
- [x] `Spreadsheet.holdLinkCardHover` on the card's `pointerenter`, so the
      hand-off holds after a slow move through the gap, too
- [x] `Spreadsheet.releaseLinkCardHover` whenever the card closes, including
      when a revision preview opens
- [x] Tests for the hand-off in `worksheet-links.test.ts`, and for the host
      wiring in `sheet-view-link-card.test.tsx`
- [x] Update §5 of `docs/design/sheets/sheet-hyperlink.md`
- [x] `pnpm verify:fast`
- [x] Manual check in `pnpm dev`

