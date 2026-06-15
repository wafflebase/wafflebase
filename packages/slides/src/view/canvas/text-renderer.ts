import {
  CanvasTextMeasurer,
  computeLayout,
  normalizeBlockStyle,
  paintLayout,
  resolveFontFamily,
  type Block,
  type ColorResolver,
  type StoredColor,
} from '@wafflebase/docs';
import { computeAutofitScale, scaleBlocks } from '../../model/autofit';
import {
  isBlocksEmpty,
  type TextBody,
  type TextElement,
  type VerticalAnchorMode,
} from '../../model/element';
import type { PlaceholderStyle } from '../../model/master';
import type { Theme, ThemeColor } from '../../model/theme';
import { resolveColor, resolveFont } from '../../model/theme';
import type { FrameSize } from './shapes/builder';
import { dashArray, resolveStrokeColor } from './render-context';

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
    /**
     * Multiplier applied to font sizes / margins before handing blocks
     * to docs. Comes from the deck's `pxPerPt`; absent ⇒ no scaling.
     */
    fontScale?: number;
  },
): void {
  // Box decorations (background fill + border) paint first and
  // unconditionally — a bordered text box with no text must still show
  // its border. Mirrors how `drawShape` paints `data.fill`/`data.stroke`
  // for shapes; without this the toolbar's border/fill pickers write to
  // the model but nothing renders.
  paintTextBoxDecorations(ctx, size, data, theme);
  // "All inlines empty" mirrors `isElementEmpty` for text elements:
  // a placeholder seeded by `buildInsertElement` typically has one
  // block with one inline whose `text === ''`, so the cheaper-to-detect
  // `data.blocks.length === 0` case alone is not sufficient.
  if (isTextBodyEmpty(data)) {
    if (options?.placeholderHint) {
      // Hint always paints at the top of the frame regardless of
      // data.verticalAnchor — placeholder ghost text is not anchor-aware
      // today. Revisit alongside editor parity.
      drawHint(
        ctx,
        size,
        options.placeholderHint.text,
        theme,
        options.placeholderHint.style,
        options.fontScale,
      );
    }
    return;
  }
  paintTextBody(ctx, size, data, theme, { fontScale: options?.fontScale });
}

/**
 * Paint a text element's box-level background fill and border into
 * element-local coordinates (top-left at 0,0). Mirrors the fill/stroke
 * branch of `drawShape` so a text box decorated via the toolbar's
 * background / border pickers renders identically to a shape. No-op when
 * the box carries neither a fill nor a stroke.
 */
function paintTextBoxDecorations(
  ctx: CanvasRenderingContext2D,
  { w, h }: FrameSize,
  data: TextElement['data'],
  theme: Theme,
): void {
  if (data.fill) {
    ctx.fillStyle = resolveColor(data.fill, theme);
    ctx.fillRect(0, 0, w, h);
  }
  if (data.stroke) {
    ctx.strokeStyle = resolveStrokeColor(data.stroke.color, theme);
    ctx.lineWidth = data.stroke.width;
    ctx.setLineDash(dashArray(data.stroke.dash));
    ctx.strokeRect(0, 0, w, h);
    // Reset so the dash pattern does not leak into anything painted
    // afterward under the same ctx save scope.
    ctx.setLineDash([]);
  }
}

/**
 * True iff a `TextBody` carries no visible characters. Thin wrapper
 * over the model-level `isBlocksEmpty`; kept as a named view-layer
 * symbol because the placeholder-hint branch reads more naturally as
 * "the text body is empty" than "its blocks are empty".
 */
export function isTextBodyEmpty(body: TextBody): boolean {
  return isBlocksEmpty(body.blocks);
}

/**
 * Paint a non-empty `TextBody` into the given frame. Shared between
 * `drawText` (text elements) and `drawShape` (shapes that carry inline
 * text via `data.text`). Layout + paint go through
 * `@wafflebase/docs.paintLayout` so all surfaces produce pixel-identical
 * output.
 *
 * Callers can supply optional `padding` (insets the layout width and
 * paint origin) and a `defaultVerticalAnchor` (used when the body
 * doesn't set its own anchor). Shape callers typically pass
 * `defaultVerticalAnchor: 'middle'` and a small padding to mirror
 * PowerPoint / Google Slides defaults; text-element callers pass
 * neither (anchor defaults to `'top'`, padding `0`).
 *
 * Skips painting when the body is empty.
 */
export function paintTextBody(
  ctx: CanvasRenderingContext2D,
  size: FrameSize,
  body: TextBody,
  theme: Theme,
  opts: {
    padding?: { x: number; y: number };
    defaultVerticalAnchor?: VerticalAnchorMode;
    /**
     * Deck-level pre-scale (from `deckFontScale(meta)`). PPTX decks
     * authored at a non-default physical size set this so 52 pt still
     * occupies the proportion PowerPoint expects on a 1920-px canvas.
     * Absent / `1` ⇒ docs default 96-DPI conversion only.
     */
    fontScale?: number;
  } = {},
): void {
  if (isTextBodyEmpty(body)) return;
  const padX = opts.padding?.x ?? 0;
  const padY = opts.padding?.y ?? 0;
  const innerW = Math.max(0, size.w - 2 * padX);
  const innerH = Math.max(0, size.h - 2 * padY);

  // Apply the deck-level pre-scale first so all downstream measurements
  // (wrap width fit, shrink-autofit, vertical-anchor offset) operate on
  // already-DPI-corrected blocks. Shrink runs on top of the pre-scaled
  // blocks; the editor wires the same composition through
  // `transformLayoutBlocks` so committed canvas and in-place edit stay
  // pixel-identical.
  let toLayout = prepareBlocksForLayout(body, opts.fontScale ?? 1);
  if (toLayout === null) return;
  if (body.autofit === 'shrink') {
    const scale = computeAutofitScale(toLayout, measurer, innerW, innerH, 0);
    if (scale !== 1) toLayout = scaleBlocks(toLayout, scale);
  }

  const { layout } = computeLayout(toLayout, measurer, innerW);
  const colorResolver = makeColorResolver(theme);
  const anchor = body.verticalAnchor ?? opts.defaultVerticalAnchor ?? 'top';
  const originY =
    padY + computeVerticalOriginY(anchor, innerH, layout.totalHeight);
  paintLayout(ctx, layout, padX, originY, { colorResolver });
}

/**
 * Internal shared pre-layout pipeline used by both `paintTextBody` and
 * `measureTextBodyHeight`: normalize per-block styles + apply the
 * deck-level `fontScale`. Returns `null` when the body has no visible
 * content (callers should short-circuit).
 *
 * Centralising this step prevents the two helpers from drifting on
 * normalization edge cases (e.g., sparse `style: {}` paragraphs
 * defaulting to `marginTop: 0`) and is the only place that needs
 * updating when a new pre-layout transform lands.
 */
function prepareBlocksForLayout(
  body: TextBody,
  fontScale: number,
): Block[] | null {
  if (isTextBodyEmpty(body)) return null;
  const normalized: Block[] = body.blocks.map((b) => ({
    ...b,
    style: normalizeBlockStyle(b.style),
  }));
  return fontScale !== 1 ? scaleBlocks(normalized, fontScale) : normalized;
}

/**
 * Measure the laid-out height of a `TextBody` at a given inner width.
 * Applies the deck-level `fontScale` exactly like `paintTextBody`
 * would, but **does NOT apply `autofit: 'shrink'`** — measurement is
 * driven by table row auto-grow, which expects to learn the *natural*
 * (un-shrunken) height of the content so the row can grow to fit it.
 * Returns 0 for empty bodies so callers can treat "no text" and "text
 * that lays out to zero" identically.
 *
 * Tables consume this output to grow row heights when cell content
 * exceeds the declared `<a:tr h>`. The painter — which IS allowed to
 * apply shrink autofit — runs after the row has already grown, so in
 * practice the shrink branch never fires for table cells and the
 * measure-vs-paint heights stay consistent.
 *
 * Callers that genuinely need shrink-aware measurement (e.g. computing
 * the laid-out height inside a fixed-height frame) must run
 * `computeAutofitScale` themselves with the target height and call
 * this helper on the pre-shrunken blocks.
 */
export function measureTextBodyHeight(
  body: TextBody,
  innerW: number,
  opts: { fontScale?: number } = {},
): number {
  const toLayout = prepareBlocksForLayout(body, opts.fontScale ?? 1);
  if (toLayout === null) return 0;
  // Intentionally skip the `body.autofit === 'shrink'` branch from
  // paintTextBody — see the doc-comment above for why.
  const { layout } = computeLayout(toLayout, measurer, innerW);
  return layout.totalHeight;
}

/**
 * Compute the y offset that aligns laid-out content to the requested
 * vertical anchor inside a frame of height `frameH`.
 *
 * - `'top'` (and absent) ⇒ 0 (preserves pre-feature behavior).
 * - `'middle'` ⇒ `(frameH − contentH) / 2`.
 * - `'bottom'` ⇒ `frameH − contentH`.
 *
 * On overflow (`contentH > frameH`) the middle/bottom offsets go
 * negative, painting some text above the frame top. This matches
 * PowerPoint and Google Slides — middle stays centered on the frame
 * (text extends both above and below), bottom stays anchored to the
 * frame bottom (text extends above). Authors who need the overflow to
 * stay inside the frame should opt into `<a:normAutofit>` (`autofit:
 * 'shrink'`), which shrinks the type before anchor offset is computed.
 */
function computeVerticalOriginY(
  anchor: VerticalAnchorMode | undefined,
  frameH: number,
  contentH: number,
): number {
  if (anchor === 'middle') return (frameH - contentH) / 2;
  if (anchor === 'bottom') return frameH - contentH;
  return 0;
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
  fontScale: number = 1,
): void {
  ctx.save();
  const color = resolveColor({ kind: 'role', role: style.colorRole }, theme);
  const family = resolveFont({ kind: 'role', role: style.fontRole }, theme);
  ctx.fillStyle = withAlpha(color, 0.4);
  // `style.fontSize` is already in px here (placeholder styles use px,
  // not pt — they predate the docs-shared text path). Multiply by the
  // deck-level fontScale so the ghost hint visually matches the
  // committed text inside this placeholder once the user types.
  // Route the raw theme family through `resolveFontFamily` so the
  // ghost hint picks up the same Korean fallback chain typed text gets
  // via `paintLayout → buildFont`. Without this, a Korean placeholder
  // hint ("제목을 추가하려면 클릭하세요") on a Latin-themed deck would
  // fall back to the browser default while real text in the same
  // placeholder rendered through Noto Sans KR.
  ctx.font = `${style.fontSize * fontScale}px ${resolveFontFamily(family)}`;
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
