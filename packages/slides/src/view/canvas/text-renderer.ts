import {
  CanvasTextMeasurer,
  computeLayout,
  normalizeBlockStyle,
  paintLayout,
  type Block,
  type ColorResolver,
  type StoredColor,
} from '@wafflebase/docs';
import { computeAutofitScale, scaleBlocks } from '../../model/autofit';
import type { TextElement } from '../../model/element';
import type { PlaceholderStyle } from '../../model/master';
import type { Theme, ThemeColor } from '../../model/theme';
import { resolveColor, resolveFont } from '../../model/theme';
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
export function makeColorResolver(theme: Theme): ColorResolver {
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
  size: FrameSize,
  data: TextElement['data'],
  theme: Theme,
  options?: {
    placeholderHint?: { text: string; style: PlaceholderStyle };
  },
): void {
  // "All inlines empty" mirrors `isElementEmpty` for text elements:
  // a placeholder seeded by `buildInsertElement` typically has one
  // block with one inline whose `text === ''`, so the cheaper-to-detect
  // `data.blocks.length === 0` case alone is not sufficient.
  const allEmpty =
    data.blocks.length === 0 ||
    data.blocks.every((b) => b.inlines.every((inl) => inl.text === ''));

  if (allEmpty) {
    if (options?.placeholderHint) {
      drawHint(
        ctx,
        size,
        options.placeholderHint.text,
        theme,
        options.placeholderHint.style,
      );
    }
    return;
  }
  const normalized: Block[] = data.blocks.map((b) => ({
    ...b,
    style: normalizeBlockStyle(b.style),
  }));
  const colorResolver = makeColorResolver(theme);

  // Shrink autofit: scale fonts down so content fits the fixed box. The
  // same scale is applied in the in-place editor (text-box-editor.ts) so
  // the committed canvas and editing surface stay pixel-identical.
  let toLayout = normalized;
  if (data.autofit === 'shrink') {
    const scale = computeAutofitScale(normalized, measurer, size.w, size.h, 0);
    if (scale !== 1) toLayout = scaleBlocks(normalized, scale);
  }

  const { layout } = computeLayout(toLayout, measurer, size.w);
  paintLayout(ctx, layout, 0, 0, { colorResolver });
}

/**
 * Paint the muted "Click to add title"-style hint inside an empty
 * placeholder. The hint adopts the slot's master `PlaceholderStyle`
 * (font role + size, color role, alignment) so the title slot
 * renders the hint at title scale, the body slot at body scale,
 * the subtitle slot at subtitle scale — matching what the user
 * will see the moment they start typing.
 *
 * The role color is rendered at 40% alpha so the hint reads as
 * ghost-text rather than committed content.
 */
function drawHint(
  ctx: CanvasRenderingContext2D,
  size: FrameSize,
  hint: string,
  theme: Theme,
  style: PlaceholderStyle,
): void {
  ctx.save();
  const color = resolveColor({ kind: 'role', role: style.colorRole }, theme);
  const family = resolveFont({ kind: 'role', role: style.fontRole }, theme);
  ctx.fillStyle = withAlpha(color, 0.4);
  ctx.font = `${style.fontSize}px ${family}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = style.align;
  const padding = 8;
  const x =
    style.align === 'center' ? size.w / 2
    : style.align === 'right' ? size.w - padding
    : padding;
  ctx.fillText(hint, x, padding);
  ctx.restore();
}

/**
 * Convert a hex color (`#RRGGBB` or 3-char shorthand `#RGB`) to an
 * `rgba(...)` string with the given alpha. Falls back to neutral grey
 * on parse failure so a malformed theme color still renders a visible
 * — if untheme'd — ghost rather than nothing at all.
 */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex);
  if (!m) return `rgba(128, 128, 128, ${alpha})`;
  const h =
    m[1].length === 3
      ? m[1]
          .split('')
          .map((c) => c + c)
          .join('')
      : m[1];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
