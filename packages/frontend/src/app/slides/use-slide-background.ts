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
 * `BackgroundSidePanel` (the shared Theme/Motion/Format-panel-parity right
 * side surface, used on both desktop and mobile) consumes this so the
 * store-write rules — one background per slide (a solid/gradient fill and
 * an image are mutually exclusive; setting one drops the other), batched
 * `updateSlideBackground` writes, `pushRecentColor` on a recorded sRGB
 * pick, and the gradient live-drag draft that avoids spamming the CRDT on
 * every pointermove — live in exactly one place.
 *
 * `onCommit` fires for a discrete, "close the popover/sheet" action (a
 * swatch pick, a gradient drag release, an image choice, a reset); live
 * custom-input changes (including an in-flight gradient drag) keep it
 * open. `BackgroundSidePanel` passes no `onCommit` — unlike the old
 * dropdown/sheet, the panel stays open across edits, matching Theme /
 * Motion / Format.
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
  onChangeImageOpacity: (opacity: number) => void;
  onRemoveImage: () => void;
  onResetToTheme: () => void;
  onApplyToAll: () => void;
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

  const onChangeImageOpacity = useCallback(
    (opacity: number) => {
      if (!store || !slideId || !backgroundImage) return;
      store.batch(() =>
        store.updateSlideBackground(slideId, {
          image: { ...backgroundImage, opacity },
        }),
      );
    },
    [store, slideId, backgroundImage],
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

  // "Apply to all slides" (Google Slides' "Add to theme"): write the
  // current slide's *resolved* background (fill or image, following the
  // same slide → layout → master inheritance the picker itself reads)
  // onto the deck's master. Every slide that doesn't override its own
  // background inherits it on the next repaint; slides with an explicit
  // per-slide `background` are untouched, matching Google Slides.
  const onApplyToAll = useCallback(() => {
    if (!store || !slideId) return;
    const doc = store.read();
    const slide = doc.slides.find((s) => s.id === slideId);
    if (!slide) return;
    const fill = resolveBackgroundFill(slide, doc);
    const image = resolveBackgroundImage(slide, doc);
    // A slide's fill/image are mutually exclusive, but a master's `fill`
    // (required) and `image` (optional overlay) are not — `image` here may
    // be inherited from the layout/master rather than owned by this slide
    // (a slide can't opt out of an inherited image), so always propagate
    // the resolved fill and layer the image on top only when present.
    store.batch(() =>
      store.updateMaster(doc.meta.masterId, {
        background: { fill, ...(image ? { image } : {}) },
      }),
    );
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
    onChangeImageOpacity,
    onRemoveImage,
    onResetToTheme,
    onApplyToAll,
  };
}
