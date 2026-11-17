import {
  makeDefaultSlidesTextBlock,
  type Element,
  type SlidesStore,
  type TextBody,
} from "@wafflebase/slides";
import { SYNTHETIC_SLIDE_ID, type StickyDataExtras } from "@wafflebase/board";

/** A sticky size preset. */
export interface StickySizePreset {
  id: "s" | "m" | "l" | "wide";
  label: string;
  w: number;
  h: number;
}

/** Small / Medium (the default) / Large squares, and a Wide 2:1 note. */
export const STICKY_SIZE_PRESETS: readonly StickySizePreset[] = [
  { id: "s", label: "Small", w: 120, h: 120 },
  { id: "m", label: "Medium", w: 180, h: 180 },
  { id: "l", label: "Large", w: 260, h: 260 },
  { id: "wide", label: "Wide", w: 360, h: 180 },
];

/** The preset `frame` matches (to a pixel), or `undefined`. */
export function stickySizePresetOf(frame: { w: number; h: number }): StickySizePreset | undefined {
  return STICKY_SIZE_PRESETS.find(
    (p) => Math.abs(p.w - frame.w) < 1 && Math.abs(p.h - frame.h) < 1,
  );
}

/**
 * Whether a corner resize of this sticky keeps its aspect without Shift
 * (the editor's `lockAspectRatio`): square stickies stay square, as in
 * FigJam. A Wide (or any non-square) sticky resizes freely.
 */
export function stickyKeepsAspect(el: { frame: { w: number; h: number } }): boolean {
  return Math.abs(el.frame.w - el.frame.h) < 1;
}

/**
 * Resize the stickies `ids` to `preset` about their centres, in one
 * batch (one undo unit).
 */
export function applyStickySize(
  store: SlidesStore,
  elements: readonly Element[],
  ids: readonly string[],
  preset: StickySizePreset,
): void {
  store.batch(() => {
    for (const id of ids) {
      const el = elements.find((e) => e.id === id);
      if (!el) continue;
      const cx = el.frame.x + el.frame.w / 2;
      const cy = el.frame.y + el.frame.h / 2;
      store.updateElementFrame(SYNTHETIC_SLIDE_ID, id, {
        x: cx - preset.w / 2,
        y: cy - preset.h / 2,
        w: preset.w,
        h: preset.h,
      });
    }
  });
}

/** Text sizes A− / A+ step through. */
export const STICKY_FONT_SIZES: readonly number[] = [10, 12, 14, 18, 24, 32, 40, 48, 64, 80, 96];

/** The slides default body size a sticky's text starts at. */
const DEFAULT_FONT_SIZE = 18;

/**
 * A sticky's text size: the largest inline size in its body (the size
 * the text is at before shrink-to-fit), or the default when it has none.
 */
export function stickyFontSize(el: Element): number {
  if (el.type !== "shape") return DEFAULT_FONT_SIZE;
  let max: number | undefined;
  for (const block of el.data.text?.blocks ?? []) {
    for (const inline of block.inlines) {
      const size = inline.style?.fontSize;
      if (typeof size === "number" && (max === undefined || size > max)) max = size;
    }
  }
  return max ?? DEFAULT_FONT_SIZE;
}

/** The next size on {@link STICKY_FONT_SIZES} from `current` in `direction`. */
export function stepStickyFontSize(current: number, direction: 1 | -1): number {
  if (direction > 0) {
    return (
      STICKY_FONT_SIZES.find((s) => s > current) ??
      STICKY_FONT_SIZES[STICKY_FONT_SIZES.length - 1]
    );
  }
  return [...STICKY_FONT_SIZES].reverse().find((s) => s < current) ?? STICKY_FONT_SIZES[0];
}

/**
 * Set every run in the stickies' bodies to `size`, in one batch.
 *
 * Shrink-to-fit is (re)enabled with it, which makes the size a ceiling:
 * short text grows to it, and text that would no longer fit shrinks back
 * inside the note instead of spilling over its edges. A body that has no
 * text yet gets an empty run at the size, so typing starts there.
 */
export function applyStickyFontSize(
  store: SlidesStore,
  elements: readonly Element[],
  ids: readonly string[],
  size: number,
): void {
  store.batch(() => {
    for (const id of ids) {
      const el = elements.find((e) => e.id === id);
      if (!el || el.type !== "shape") continue;
      const prior: TextBody = el.data.text ?? {
        blocks: [],
        verticalAnchor: "middle",
      };
      const blocks =
        prior.blocks.length > 0 ? prior.blocks : [makeDefaultSlidesTextBlock()];
      const text: TextBody = {
        ...prior,
        autofit: "shrink",
        blocks: blocks.map((b) => ({
          ...b,
          inlines: b.inlines.map((i) => ({ ...i, style: { ...i.style, fontSize: size } })),
        })),
      };
      store.updateElementData(SYNTHETIC_SLIDE_ID, id, { text });
    }
  });
}

function stickyExtras(el: Element): StickyDataExtras {
  return el.type === "shape" ? (el.data as StickyDataExtras) : {};
}

/** Whether the author tag shows on this sticky (absent ⇒ shown). */
export function stickyShowsAuthor(el: Element): boolean {
  return stickyExtras(el).showAuthor !== false;
}

/** Whether this sticky recorded an author. */
export function stickyHasAuthor(el: Element): boolean {
  const author = stickyExtras(el).author;
  return typeof author === "string" && author.trim() !== "";
}

/** Show or hide the author tag on the stickies `ids`, in one batch. */
export function applyStickyShowAuthor(
  store: SlidesStore,
  ids: readonly string[],
  show: boolean,
): void {
  store.batch(() => {
    for (const id of ids) {
      // `undefined` deletes the field: shown is the default.
      store.updateElementData(SYNTHETIC_SLIDE_ID, id, { showAuthor: show ? undefined : false });
    }
  });
}

/** A store that knows the board-level anonymous setting. */
export interface BoardAnonymityStore {
  isAnonymous(): boolean;
  setAnonymous(on: boolean): void;
}

/** Whether `store` is a board store with the anonymous setting. */
export function hasAnonymity(store: unknown): store is BoardAnonymityStore {
  return (
    typeof store === "object" &&
    store !== null &&
    typeof (store as Partial<BoardAnonymityStore>).isAnonymous === "function" &&
    typeof (store as Partial<BoardAnonymityStore>).setAnonymous === "function"
  );
}
