import { useCallback } from "react";
import type { SlidesStore, Theme, ThemeColor } from "@wafflebase/slides";
import { resolveBackgroundFill } from "@wafflebase/slides";

/**
 * Shared slide-background read + write semantics for the current slide.
 *
 * Both the desktop `RightGlobals` dropdown and the mobile
 * `SlideBackgroundSheet` consume this so the store-write rules
 * (batched `updateSlideBackground` + `pushRecentColor` on a recorded
 * sRGB pick) live in exactly one place. `onCommit` fires only for a
 * discrete swatch pick (`opts.commit`) so the caller can close its
 * popover/sheet; live custom-input changes keep it open.
 */
export function useSlideBackground(
  store: SlidesStore | null,
  slideId: string | undefined,
  theme: Theme | null,
  onCommit?: () => void,
): {
  backgroundFill: ThemeColor | undefined;
  onChange: (
    color: ThemeColor,
    opts?: { commit?: boolean; record?: boolean },
  ) => void;
} {
  // Computed per render (not memoized): the effective fill depends on the
  // slide's layout and master, which can change without `store`/`slideId`/
  // `theme` identity changing — a memo on those keys would go stale. The
  // read is cheap relative to a repaint and callers already re-render on
  // store changes.
  const resolveFill = (): ThemeColor | undefined => {
    if (!store || !slideId || !theme) return undefined;
    const doc = store.read();
    const slide = doc.slides.find((s) => s.id === slideId);
    if (!slide) return undefined;
    // Resolve slide → layout → master → role so the swatch reflects what
    // the slide actually shows (slides inherit by default, so a raw
    // `slide.background.fill` read would be undefined → blank control).
    return resolveBackgroundFill(slide, doc);
  };
  const backgroundFill = resolveFill();

  const onChange = useCallback(
    (color: ThemeColor, opts?: { commit?: boolean; record?: boolean }) => {
      if (!store || !slideId) return;
      store.batch(() => {
        store.updateSlideBackground(slideId, { fill: color });
        if (opts?.record && color.kind === "srgb") {
          store.pushRecentColor(color.value);
        }
      });
      if (opts?.commit) onCommit?.();
    },
    [store, slideId, onCommit],
  );

  return { backgroundFill, onChange };
}
