import { useCallback, useMemo } from "react";
import type { SlidesStore, Theme, ThemeColor } from "@wafflebase/slides";

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
  const backgroundFill = useMemo(() => {
    if (!store || !slideId || !theme) return undefined;
    return store.read().slides.find((s) => s.id === slideId)?.background?.fill;
  }, [store, slideId, theme]);

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
