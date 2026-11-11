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

- [x] Move the card's open/close state out of `sheet-view.tsx` into
      `useLinkHoverCard`, which ignores the engine's `null` while the pointer
      is inside the card
- [x] Reset the "pointer in card" flag whenever the card closes (it unmounts
      without a `pointerleave`)
- [x] Tests for the hook, including the `pointerenter` → `null` order
- [x] Update §5 of `docs/design/sheets/sheet-hyperlink.md`
- [x] `pnpm verify:fast`
- [x] Manual check in `pnpm dev`: the card stays open and its link opens
