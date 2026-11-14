import * as React from "react";

/**
 * Which edges of a horizontal scroller have content beyond them. The 1px
 * slack absorbs the sub-pixel `scrollLeft` a zoomed or high-DPR page
 * reports at the very end of the scroll.
 */
export function overflowEdges(el: {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}): "start" | "end" | "both" | null {
  // `scrollLeft` is negative in an RTL scroller; the distance is what counts.
  const left = Math.abs(el.scrollLeft);
  const start = left > 1;
  const end = el.scrollWidth - el.clientWidth - left > 1;
  if (start && end) return "both";
  if (start) return "start";
  if (end) return "end";
  return null;
}

/**
 * Keeps `data-overflow` on the element in step with `overflowEdges`.
 * Written straight to the DOM rather than through state: it changes on
 * every scroll frame, and re-rendering a whole toolbar for an attribute
 * the CSS alone reads would be the expensive way to do it. Re-measured
 * on scroll, on the strip's own resize, and when its children change —
 * the Slides toolbar morphs between idle, object and text-edit sets
 * without the strip itself changing size.
 */
export function useOverflowEdges<T extends HTMLElement>() {
  const ref = React.useRef<T | null>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const edges = overflowEdges(el);
      if (edges) el.dataset.overflow = edges;
      else delete el.dataset.overflow;
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const resize =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    resize?.observe(el);
    const mutation =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(update);
    mutation?.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      el.removeEventListener("scroll", update);
      resize?.disconnect();
      mutation?.disconnect();
    };
  }, []);
  return ref;
}
