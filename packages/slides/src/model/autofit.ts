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
 * Multiply every inline font size, block vertical margin, AND horizontal
 * indent by `scale`. Pure: returns new objects but preserves block/inline
 * identity (id, type, text, ordering, counts) so a `Cursor`/`Selection`
 * keyed by (blockId, offset) stays valid against the scaled layout.
 * `lineHeight` is a ratio and is intentionally left unscaled.
 *
 * Horizontal fields (`marginLeft`, `textIndent`) ride along so the
 * bullet → text hang indent stays proportional to font size in both
 * directions:
 * - Shrink: at a 0.7 font scale, the bullet sits closer to the body
 *   text instead of carrying a body-sized gap into the shrunken layout.
 * - Deck-DPI (slides `deckFontScale`): at a 2× scale, the imported
 *   PPTX hang indent (e.g. 36 px from a `-342900` EMU `<a:indent>`)
 *   doubles to 72 px so the bullet → text gap matches PowerPoint at
 *   the deck's actual physical resolution.
 */
export function scaleBlocks(blocks: Block[], scale: number): Block[] {
  if (scale === 1) return blocks;
  return blocks.map((b) => ({
    ...b,
    style: {
      ...b.style,
      marginTop: b.style.marginTop * scale,
      marginBottom: b.style.marginBottom * scale,
      marginLeft: b.style.marginLeft * scale,
      textIndent: b.style.textIndent * scale,
    },
    inlines: b.inlines.map((inl) => ({
      ...inl,
      style: {
        ...inl.style,
        fontSize: (inl.style.fontSize ?? DEFAULT_INLINE_STYLE.fontSize ?? 11) * scale,
      },
    })),
    // Scale the marker font size in lockstep with inline runs so the
    // bullet glyph stays proportional to the body text after shrink.
    // Without this, an authored `marker.fontSize` (from PPTX
    // `<a:buSzPts>`) would stay at 18pt while inlines drop to 12pt,
    // leaving an oversized marker beside shrunken text. `marker.color`
    // and `marker.fontFamily` are not size-dependent and pass through.
    ...(b.marker?.fontSize != null
      ? { marker: { ...b.marker, fontSize: b.marker.fontSize * scale } }
      : {}),
  }));
}

/**
 * Largest font scale in [FLOOR, 1] whose laid-out height fits the box.
 * (FLOOR is inclusive: it is returned when even the smallest probe
 * overflows, or when the box has no usable height.)
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
