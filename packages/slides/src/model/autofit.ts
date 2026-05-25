import {
  computeLayout,
  DEFAULT_INLINE_STYLE,
  type Block,
  type TextMeasurer,
} from '@wafflebase/docs';

/** Lowest font scale shrink will ever apply (matches the box-protect intent). */
const SHRINK_FLOOR = 0.1;
/** Binary-search iterations; ~8 lands within ~0.4% of the true fit. */
const SEARCH_STEPS = 8;

/**
 * Multiply every inline font size and block vertical margin by `scale`.
 * Pure: returns new objects but preserves block/inline identity (id,
 * type, text, ordering, counts) so a `Cursor`/`Selection` keyed by
 * (blockId, offset) stays valid against the scaled layout. `lineHeight`
 * is a ratio and is intentionally left unscaled.
 */
export function scaleBlocks(blocks: Block[], scale: number): Block[] {
  if (scale === 1) return blocks;
  return blocks.map((b) => ({
    ...b,
    style: {
      ...b.style,
      marginTop: b.style.marginTop * scale,
      marginBottom: b.style.marginBottom * scale,
    },
    inlines: b.inlines.map((inl) => ({
      ...inl,
      style: {
        ...inl.style,
        fontSize: (inl.style.fontSize ?? DEFAULT_INLINE_STYLE.fontSize ?? 11) * scale,
      },
    })),
  }));
}

/** Content height for grow mode: laid-out height + symmetric padding. */
export function computeAutofitHeight(
  blocks: Block[],
  measurer: TextMeasurer,
  frameW: number,
  padding: number,
): number {
  return computeLayout(blocks, measurer, frameW).layout.totalHeight + 2 * padding;
}

/**
 * Largest font scale in (FLOOR, 1] whose laid-out height fits the box.
 * Height is non-linear in scale (smaller fonts wrap differently), so this
 * binary-searches, re-laying-out per probe. Returns 1 when the content
 * already fits — shrink never enlarges past authored size.
 */
export function computeAutofitScale(
  blocks: Block[],
  measurer: TextMeasurer,
  frameW: number,
  frameH: number,
  padding: number,
): number {
  const avail = frameH - 2 * padding;
  if (avail <= 0) return SHRINK_FLOOR;
  if (computeLayout(blocks, measurer, frameW).layout.totalHeight <= avail) return 1;

  let lo = SHRINK_FLOOR;
  let hi = 1;
  for (let i = 0; i < SEARCH_STEPS; i++) {
    const mid = (lo + hi) / 2;
    const h = computeLayout(scaleBlocks(blocks, mid), measurer, frameW).layout.totalHeight;
    if (h <= avail) lo = mid;
    else hi = mid;
  }
  return lo;
}
