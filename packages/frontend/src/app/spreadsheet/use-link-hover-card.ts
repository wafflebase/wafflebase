import { useCallback, useEffect, useRef, useState } from "react";
import type { LinkHoverInfo } from "@wafflebase/sheets";

/**
 * Long enough to cross the few pixels between the cell and the card, which
 * belong to neither and so read to the engine as "the pointer left".
 */
export const LinkHoverCloseDelayMS = 250;

/**
 * `useLinkHoverCard` owns the open/close lifecycle of the hyperlink hover card
 * (docs/design/sheets/sheet-hyperlink.md §5).
 *
 * The engine reports `null` whenever the pointer is no longer over a link
 * cell, and that includes the pointer having moved *into the card*: the card
 * is not inside the grid's scroll container, so entering it fires the
 * container's `mouseleave`, and the engine's leave handler resets its hover.
 * Pointer events run before the compatibility mouse events, so that reset
 * arrives right after the card's `pointerenter` has cancelled the pending
 * close — and would re-arm it, closing the card under a resting pointer and
 * sending the click meant for one of its links to the cell beneath (#1124).
 *
 * So while the pointer is inside the card, the engine's `null` is ignored; the
 * card's own `pointerleave` is what closes it. A cell the engine reports
 * (`info`) still replaces the card, and `dismiss` closes it unconditionally
 * for teardown.
 */
export function useLinkHoverCard() {
  const [linkHover, setLinkHover] = useState<LinkHoverInfo | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerInCardRef = useRef(false);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      // The card unmounts without a `pointerleave`, so the flag would
      // otherwise stay set and swallow the next card's close.
      pointerInCardRef.current = false;
      setLinkHover(null);
    }, LinkHoverCloseDelayMS);
  }, [cancelClose]);

  const onEngineLinkHover = useCallback(
    (info: LinkHoverInfo | null) => {
      if (info) {
        cancelClose();
        setLinkHover(info);
        return;
      }
      if (pointerInCardRef.current) {
        return;
      }
      scheduleClose();
    },
    [cancelClose, scheduleClose],
  );

  const onCardPointerEnter = useCallback(() => {
    pointerInCardRef.current = true;
    cancelClose();
  }, [cancelClose]);

  const onCardPointerLeave = useCallback(() => {
    pointerInCardRef.current = false;
    scheduleClose();
  }, [scheduleClose]);

  const dismiss = useCallback(() => {
    cancelClose();
    pointerInCardRef.current = false;
    setLinkHover(null);
  }, [cancelClose]);

  useEffect(() => cancelClose, [cancelClose]);

  return {
    linkHover,
    onEngineLinkHover,
    onCardPointerEnter,
    onCardPointerLeave,
    dismiss,
  };
}
