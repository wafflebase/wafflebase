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
 * Build a docs `ColorResolver` from the active deck `Theme`. The resolver
 * routes text colors through the deck theme so newly typed text follows
 * theme switches:
 *
 * - `undefined` / `null` → resolves to the deck's `text` role color, so
 *   inline runs without an explicit color (sparse-style new runs) inherit
 *   the theme.
 * - The docs default text color string `'#000000'` → also resolves to
 *   the `text` role. The docs editor seeds new inlines through
 *   `DEFAULT_INLINE_STYLE.color = '#000000'`; without this remap, every
 *   character a user types would land as concrete black and ignore theme
 *   switches. Users who *explicitly* pick black via the picker write
 *   `{ kind: 'srgb', value: '#000000' }` (an object), which falls through
 *   the `typeof === 'string'` branch — their intent is preserved.
 * - Other plain hex strings → pass through unchanged (legacy explicit
 *   colors, unaffected).
 * - `ThemeColor`-shaped objects (`{ kind: 'role' | 'srgb' }`) → resolve
 *   via the slides `resolveColor`.
 */
function makeColorResolver(theme: Theme): ColorResolver {
  const themeText = resolveColor({ kind: 'role', role: 'text' }, theme);
  return (c: StoredColor | undefined) => {
    if (c == null) return themeText;
    if (typeof c === 'string') {
      return c.toLowerCase() === '#000000' ? themeText : c;
    }
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
