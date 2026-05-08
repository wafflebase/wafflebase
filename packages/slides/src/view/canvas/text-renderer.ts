import {
  CanvasTextMeasurer,
  computeLayout,
  normalizeBlockStyle,
  paintLayout,
  type Block,
  type ColorResolver,
  type StoredColor,
} from '@wafflebase/docs';
import type { TextElement } from '../../model/element';
import type { Theme, ThemeColor } from '../../model/theme';
import { resolveColor } from '../../model/theme';
import type { FrameSize } from './shape-renderer';

/**
 * Module-scope measurer reused across every text-element render. Owning
 * one shared instance is essential for the per-measurer width cache
 * that `computeLayout` relies on — a fresh measurer per call would
 * thrash the cache.
 */
const measurer = new CanvasTextMeasurer();

/**
 * Build a docs `ColorResolver` from the active deck `Theme`. Plain hex
 * strings pass through unchanged; `StoredColor` objects matching the
 * slides `ThemeColor` shape (`{ kind: 'role' | 'srgb' }`) route through
 * `resolveColor` so role-bound text picks up the deck's accent /
 * text / background hex at paint time.
 *
 * Returning `undefined` for unrecognised role names lets docs fall back
 * to its `theme.defaultColor` instead of painting a literal "undefined".
 */
function makeColorResolver(theme: Theme): ColorResolver {
  return (c: StoredColor | undefined) => {
    if (c == null) return undefined;
    if (typeof c === 'string') return c;
    // The docs `StoredColor` object shape is structurally compatible
    // with slides' `ThemeColor` (both use `kind: 'role' | 'srgb'`); the
    // cast is the only seam where the two type vocabularies meet.
    return resolveColor(c as ThemeColor, theme);
  };
}

/**
 * Draw a text element into element-local coordinates (top-left at 0,0).
 * The frame transform belongs to the element-renderer; this function
 * only knows about (w, h) and the rich-text blocks.
 *
 * Layout AND painting are delegated to `@wafflebase/docs` so that the
 * committed slide canvas and the in-place text-box editor (which also
 * calls `paintLayout`) produce pixel-identical output — same baseline
 * math, same font-size handling, same list-marker glyphs.
 *
 * Block styles are normalised before layout because slides may persist
 * blocks with sparse `style: {}` (e.g. via `buildInsertElement`) and
 * `computeLayout` does `y += block.style.marginTop` without a fallback
 * — `undefined` would NaN-out the cumulative y and the text would paint
 * at the top edge of the frame instead of where the editor (which
 * normalises through `MemDocStore.setDocument` on mount) drew it.
 *
 * `theme` is funnelled into a `ColorResolver` so role-bound
 * `Inline.style.color` / `backgroundColor` values render in the deck's
 * theme palette. String colors continue to render verbatim — so existing
 * sheets/docs callers are completely unaffected.
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  { w }: FrameSize,
  data: TextElement['data'],
  theme: Theme,
): void {
  if (data.blocks.length === 0) return;
  const normalized: Block[] = data.blocks.map((b) => ({
    ...b,
    style: normalizeBlockStyle(b.style),
  }));
  const colorResolver = makeColorResolver(theme);
  const { layout } = computeLayout(normalized, measurer, w);
  paintLayout(ctx, layout, 0, 0, { colorResolver });
}
