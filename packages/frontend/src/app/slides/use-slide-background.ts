import { useCallback, useEffect, useState } from "react";
import type {
  BackgroundImage,
  Fill,
  GradientFill,
  SlidesStore,
  Theme,
  ThemeColor,
} from "@wafflebase/slides";
import { resolveBackgroundFill, resolveBackgroundImage } from "@wafflebase/slides";

/**
 * Shared slide-background read + write semantics for the current slide.
 *
 * Both the desktop `RightGlobals` dropdown and the mobile
 * `SlideBackgroundSheet` consume this so the store-write rules — one
 * background per slide (a solid/gradient fill and an image are mutually
 * exclusive; setting one drops the other), batched `updateSlideBackground`
 * writes, `pushRecentColor` on a recorded sRGB pick, and the gradient
 * live-drag draft that avoids spamming the CRDT on every pointermove —
 * live in exactly one place.
 *
 * `onCommit` fires for a discrete, "close the popover/sheet" action
 * (a swatch pick, a gradient drag release, an image choice, a reset);
 * live custom-input changes (including an in-flight gradient drag) keep
 * it open.
 */
export function useSlideBackground(
  store: SlidesStore | null,
  slideId: string | undefined,
  theme: Theme | null,
  onCommit?: () => void,
): {
  backgroundFill: Fill | undefined;
  backgroundImage: BackgroundImage | undefined;
  gradientDraft: GradientFill | null;
  onChangeSolid: (
    color: ThemeColor,
    opts?: { commit?: boolean; record?: boolean },
  ) => void;
  onChangeGradient: (fill: GradientFill, opts?: { commit?: boolean }) => void;
  onFlushGradientDraft: () => void;
  onChooseImage: (src: string) => void;
  onRemoveImage: () => void;
  onResetToTheme: () => void;
} {
  const [gradientDraft, setGradientDraft] = useState<GradientFill | null>(
    null,
  );
  // A draft is a live-drag preview scoped to the slide it was drawn on —
  // switching slides without flushing must not leak it onto the new one.
  useEffect(() => setGradientDraft(null), [slideId]);

  // Computed per render (not memoized): the effective fill/image depend
  // on the slide's layout and master, which can change without
  // `store`/`slideId`/`theme` identity changing — a memo on those keys
  // would go stale. The read is cheap relative to a repaint and callers
  // already re-render on store changes.
  let backgroundFill: Fill | undefined;
  let backgroundImage: BackgroundImage | undefined;
  if (store && slideId && theme) {
    const doc = store.read();
    const slide = doc.slides.find((s) => s.id === slideId);
    if (slide) {
      // Resolve slide → layout → master → role so the picker reflects
      // what the slide actually shows (slides inherit by default, so a
      // raw `slide.background.fill` read would be undefined → blank
      // control).
      backgroundFill = resolveBackgroundFill(slide, doc);
      backgroundImage = resolveBackgroundImage(slide, doc);
    }
  }

  const onChangeSolid = useCallback(
    (color: ThemeColor, opts?: { commit?: boolean; record?: boolean }) => {
      if (!store || !slideId) return;
      store.batch(() => {
        // A solid fill and an image are mutually exclusive backgrounds —
        // writing `{ fill }` (no `image` key) drops any existing image.
        store.updateSlideBackground(slideId, { fill: color });
        if (opts?.record && color.kind === "srgb") {
          store.pushRecentColor(color.value);
        }
      });
      setGradientDraft(null);
      if (opts?.commit) onCommit?.();
    },
    [store, slideId, onCommit],
  );

  const persistGradient = useCallback(
    (fill: GradientFill) => {
      if (!store || !slideId) return;
      store.batch(() => store.updateSlideBackground(slideId, { fill }));
    },
    [store, slideId],
  );

  const onChangeGradient = useCallback(
    (fill: GradientFill, opts?: { commit?: boolean }) => {
      if (opts?.commit) {
        persistGradient(fill);
        setGradientDraft(null);
      } else {
        // Live drag preview: hold the value locally only. Writing every
        // pointermove into the store would spam the CRDT history with
        // an undo entry per frame.
        setGradientDraft(fill);
      }
    },
    [persistGradient],
  );

  const onFlushGradientDraft = useCallback(() => {
    if (gradientDraft) {
      persistGradient(gradientDraft);
      setGradientDraft(null);
    }
  }, [gradientDraft, persistGradient]);

  const onChooseImage = useCallback(
    (src: string) => {
      if (!store || !slideId) return;
      // Mutually exclusive with `fill` — writing `{ image }` (no `fill`
      // key) drops any existing solid/gradient fill.
      store.batch(() => store.updateSlideBackground(slideId, { image: { src } }));
      setGradientDraft(null);
      onCommit?.();
    },
    [store, slideId, onCommit],
  );

  const onRemoveImage = useCallback(() => {
    if (!store || !slideId) return;
    // Clearing both keys reverts to "inherit" (slide → layout → master).
    store.batch(() => store.updateSlideBackground(slideId, {}));
  }, [store, slideId]);

  const onResetToTheme = useCallback(() => {
    if (!store || !slideId) return;
    store.batch(() => store.updateSlideBackground(slideId, {}));
    setGradientDraft(null);
    onCommit?.();
  }, [store, slideId, onCommit]);

  return {
    backgroundFill,
    backgroundImage,
    gradientDraft,
    onChangeSolid,
    onChangeGradient,
    onFlushGradientDraft,
    onChooseImage,
    onRemoveImage,
    onResetToTheme,
  };
}
