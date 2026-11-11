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

- Round 1 (correctness and tests, self): no blocking findings.
  - Considered fixing it in the engine (skip `resetLinkHover` when
    `relatedTarget` is inside the card). That needs the engine to know
    about a host DOM node; the host already owns the card and its pointer
    events, so the fix stays in the frontend.
  - Considered a remote edit removing the hovered cell's links while the
    pointer is inside the card. The engine's hover was already reset by
    the `mouseleave`, so it sends no update and the card keeps listing the
    old links until the pointer leaves it. Before this change the card had
    closed anyway, so this is not a regression. Left as a known limitation.
  - The "pointer in card" flag is cleared on every close path (timer,
    `dismiss`), because an unmounted card fires no `pointerleave`. Covered
    by a test.
  - Stopped after one round: the change is a small hook with tests that
    fail without it.

## Verification

- `pnpm verify:fast` green.
- `pnpm dev`: moving straight from a link cell into the card kept it open
  5 of 5 times (on wafflebase.io before the fix it closed every time), and
  clicking a link in it opened the link in a new tab. Leaving the card, or
  leaving the cell sideways, still closes it.
