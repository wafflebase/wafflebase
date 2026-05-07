import type { Block } from '../model/types.js';
import { LIST_INDENT_PX, UNORDERED_MARKERS } from '../model/types.js';
import type { DocumentLayout, LayoutBlock, LayoutRun } from './layout.js';
import { computeListCounters } from './layout.js';
import type { LayoutPage } from './pagination.js';
import { Theme as DefaultTheme, type DocTheme, buildFont, ptToPx } from './theme.js';
import { getOrLoadImage } from './image-cache.js';

/**
 * Render-time options passed through `paintLayout`. Slides text-boxes
 * and DocCanvas-extracted helpers both call into the same per-run
 * painter but supply different state — DocCanvas pre-paints the
 * inline backgrounds in its two-pass body pipeline (so the local
 * selection layer stays visible inside coloured spans), while slides'
 * single-pass text-box renderer leaves `skipRunBackgrounds` unset and
 * lets `paintLayout` paint backgrounds inline.
 */
export interface PaintLayoutOpts {
  /**
   * Theme palette consulted for default font / colour fallbacks while
   * painting runs and list markers. Defaults to the docs `Theme` proxy
   * so callers that want the active theme can omit the field.
   */
  theme?: DocTheme;

  /**
   * Optional text caret in layout-local coordinates (i.e. relative to
   * the layout origin passed via `originX/originY`). When provided and
   * `visible` the caret is drawn after the run-content pass so it sits
   * on top of the painted text.
   */
  cursor?: { x: number; y: number; height: number; visible: boolean };

  /**
   * Optional selection rectangles in layout-local coordinates. Painted
   * before the run-content pass with the theme's `selectionColor`
   * (active) or `selectionColorInactive` if `selectionFocused === false`.
   */
  selectionRects?: Array<{ x: number; y: number; width: number; height: number }>;

  /** Defaults to true; toggled off to render inactive selections. */
  selectionFocused?: boolean;

  /**
   * When DocCanvas calls `paintLayout` it has already painted inline
   * run backgrounds in its own pre-pass (so peer / search / local
   * selection layers can sit on top of them). Setting this true skips
   * the inline-background pass inside `paintLayout` and tells
   * `renderRun` to skip its own per-run bg fillRect — exactly mirroring
   * the existing DocCanvas pipeline.
   */
  skipRunBackgrounds?: boolean;

  /**
   * Re-render trigger forwarded to `getOrLoadImage` so an inline image
   * that finishes loading after the first paint can request a repaint.
   * Optional — slides text-boxes that don't host images can omit it.
   */
  requestRender?: () => void;
}

/**
 * Walk a `DocumentLayout` and emit the same per-line / per-run paint
 * calls that `DocCanvas.render` makes for body content, but WITHOUT
 * any page chrome (no page background, no shadow, no page numbers,
 * no headers / footers). The layout origin lands at `(originX, originY)`
 * in CTX coords; every block / line / run is painted at
 * `originX + lb.x + run.x` / `originY + lb.y + line.y`.
 *
 * Slides text-boxes call this directly inside their own shape
 * transform; `DocCanvas.render` keeps its per-page chrome and calls
 * helpers from this module per page line so the body pipeline stays
 * single-sourced.
 *
 * Block-level layering, top-down:
 *   1. Inline run backgrounds (skipped when `skipRunBackgrounds`)
 *   2. Selection rectangles (only when `selectionRects` is supplied)
 *   3. Run content (text via `fillText`, images via `drawImage`)
 *   4. List markers on the first line of each list-item block
 *   5. Cursor caret (only when `cursor.visible`)
 *
 * Table / horizontal-rule / page-break blocks are SKIPPED — those are
 * page-aware in DocCanvas (table rows can split across pages, page
 * breaks only mean anything in the paginated body) and slides
 * text-boxes don't host them today. Adding support is a follow-up.
 */
export function paintLayout(
  ctx: CanvasRenderingContext2D,
  layout: DocumentLayout,
  originX: number,
  originY: number,
  opts: PaintLayoutOpts = {},
): void {
  const theme = opts.theme ?? DefaultTheme;
  const skipRunBackgrounds = opts.skipRunBackgrounds === true;
  const focused = opts.selectionFocused !== false;

  // 1. Inline run backgrounds — done first so the optional selection
  //    layer below sits on top of any coloured span. DocCanvas drives
  //    its own background pass via `drawInlineRunBackgroundsForPage`
  //    (page-line shaped) and passes `skipRunBackgrounds: true` to
  //    avoid painting them twice.
  if (!skipRunBackgrounds) {
    drawInlineRunBackgroundsForLayout(ctx, layout, originX, originY);
  }

  // 2. Selection rectangles. Translated by (originX, originY) so the
  //    caller can pass them in layout-local coords.
  if (opts.selectionRects && opts.selectionRects.length > 0) {
    ctx.fillStyle = focused ? theme.selectionColor : theme.selectionColorInactive;
    for (const rect of opts.selectionRects) {
      ctx.fillRect(originX + rect.x, originY + rect.y, rect.width, rect.height);
    }
  }

  // 3. Per-block content — runs, list markers, list counters.
  const listCounters = computeListCounters(layout.blocks.map((b) => b.block));
  for (const lb of layout.blocks) {
    paintBlock(ctx, lb, originX, originY, listCounters, theme, skipRunBackgrounds, opts.requestRender);
  }

  // 4. Cursor caret — drawn last so it sits on top of every run.
  if (opts.cursor?.visible) {
    ctx.fillStyle = theme.cursorColor;
    ctx.fillRect(
      originX + opts.cursor.x,
      originY + opts.cursor.y,
      theme.cursorWidth,
      opts.cursor.height,
    );
  }
}

/**
 * Paint every run on every line of a single LayoutBlock, plus its
 * list marker (when applicable). Skipped block types: `table`,
 * `horizontal-rule`, `page-break` — see `paintLayout` doc.
 */
function paintBlock(
  ctx: CanvasRenderingContext2D,
  lb: LayoutBlock,
  originX: number,
  originY: number,
  listCounters: Map<string, string>,
  theme: DocTheme,
  skipRunBackgrounds: boolean,
  requestRender: (() => void) | undefined,
): void {
  const block = lb.block;
  if (
    block.type === 'table' ||
    block.type === 'horizontal-rule' ||
    block.type === 'page-break'
  ) {
    return;
  }

  const blockX = originX + lb.x;
  const blockY = originY + lb.y;

  for (let li = 0; li < lb.lines.length; li++) {
    const line = lb.lines[li];
    const lineX = blockX;
    const lineY = blockY + line.y;
    for (const run of line.runs) {
      renderRun(ctx, run, lineX, lineY, line.height, {
        theme,
        skipBackground: skipRunBackgrounds,
        requestRender,
      });
    }

    // List markers paint on the first line of each list-item block,
    // mirroring DocCanvas's body loop.
    if (li === 0 && block.type === 'list-item') {
      const level = block.listLevel ?? 0;
      const markerX = blockX + LIST_INDENT_PX * level + LIST_INDENT_PX / 2 - 4;
      const marker =
        block.listKind === 'unordered'
          ? UNORDERED_MARKERS[level % UNORDERED_MARKERS.length]
          : (listCounters.get(block.id) ?? '1.');
      renderListMarker(ctx, block, lineY, line.height, markerX, marker, theme);
    }
  }
}

/**
 * Paint inline `style.backgroundColor` for every body run in a
 * `DocumentLayout`. Used by the slides single-pass path. DocCanvas
 * has its own page-shaped twin (`drawInlineRunBackgroundsForPage`)
 * because pagination has already sliced the layout into per-page
 * lines and walking blocks would re-paint cross-page runs.
 */
function drawInlineRunBackgroundsForLayout(
  ctx: CanvasRenderingContext2D,
  layout: DocumentLayout,
  originX: number,
  originY: number,
): void {
  for (const lb of layout.blocks) {
    const block = lb.block;
    if (
      block.type === 'table' ||
      block.type === 'horizontal-rule' ||
      block.type === 'page-break'
    ) {
      continue;
    }
    const blockX = originX + lb.x;
    const blockY = originY + lb.y;
    for (const line of lb.lines) {
      const lineY = blockY + line.y;
      for (const run of line.runs) {
        const style = run.inline.style;
        if (style.image || !style.backgroundColor) continue;
        ctx.fillStyle = style.backgroundColor;
        ctx.fillRect(
          Math.round(blockX + run.x),
          lineY,
          run.width,
          line.height,
        );
      }
    }
  }
}

/**
 * Page-shaped sibling of `drawInlineRunBackgroundsForLayout`. Walks
 * the lines on a single `LayoutPage` (so cross-page runs aren't
 * double-painted) and fills each run's inline `style.backgroundColor`.
 *
 * Called by `DocCanvas.render` BEFORE the highlight layers (search,
 * peer selection, local selection) so the translucent fills end up
 * on top of any coloured span. Body callers must pair this with
 * `renderRun(..., { skipBackground: true })` afterwards so the bg
 * isn't painted twice.
 *
 * Skips block types that handle their own background pipeline:
 * - `table`: see `renderTableBackgrounds`
 * - `horizontal-rule` / `page-break`: no inline runs
 */
export function drawInlineRunBackgroundsForPage(
  ctx: CanvasRenderingContext2D,
  page: LayoutPage,
  layout: DocumentLayout | undefined,
  pageX: number,
  pageY: number,
): void {
  for (let plIndex = 0; plIndex < page.lines.length; plIndex++) {
    const pl = page.lines[plIndex];
    if (layout) {
      const block = layout.blocks[pl.blockIndex]?.block;
      if (
        block &&
        (block.type === 'table' ||
          block.type === 'horizontal-rule' ||
          block.type === 'page-break')
      ) {
        continue;
      }
    }
    for (const run of pl.line.runs) {
      const style = run.inline.style;
      // Image runs are opaque pictures, not text — they never had a
      // bg fill in the old single-pass path either.
      if (style.image || !style.backgroundColor) continue;
      ctx.fillStyle = style.backgroundColor;
      ctx.fillRect(
        Math.round(pageX + pl.x + run.x),
        pageY + pl.y,
        run.width,
        pl.line.height,
      );
    }
  }
}

/**
 * Per-run renderRun options. `skipBackground` lets the body two-pass
 * pipeline (DocCanvas's page-line loop, paintLayout with
 * `skipRunBackgrounds`) opt out of painting the translucent run
 * background, because the bg pass already drew it before the
 * selection layer. Header/footer paths leave it unset — they don't
 * share the body's two-pass pipeline yet.
 */
export interface RenderRunOpts {
  theme?: DocTheme;
  skipBackground?: boolean;
  /**
   * Re-render trigger forwarded to `getOrLoadImage` so inline images
   * can request a repaint when they finish loading.
   */
  requestRender?: () => void;
}

/**
 * Render a single text run.
 *
 * Extracted verbatim from `DocCanvas.renderRun` so the slides
 * text-box renderer and DocCanvas's body loop call the same painter.
 * Image inlines are drawn via `drawImage`; text runs honour
 * sub/superscript baseline shift, hyperlink default styling,
 * underline, strikethrough, and per-run background fill (when
 * `skipBackground` is unset).
 */
export function renderRun(
  ctx: CanvasRenderingContext2D,
  run: LayoutRun,
  lineX: number,
  lineY: number,
  lineHeight: number,
  opts: RenderRunOpts = {},
): void {
  const theme = opts.theme ?? DefaultTheme;
  const skipBackground = opts.skipBackground === true;
  const style = run.inline.style;

  // Image inlines are rendered via drawImage, not fillText. The run's
  // width/imageHeight were set by layoutBlock (scaled to fit if needed);
  // we align the image to the line's baseline area.
  if (style.image) {
    const x = Math.round(lineX + run.x);
    const drawHeight = run.imageHeight ?? lineHeight;
    // Bottom-align the image so it sits on the text baseline row.
    const y = Math.round(lineY + lineHeight - drawHeight);
    const img = getOrLoadImage(style.image.src, () => {
      // Trigger a re-render when the image finishes loading.
      opts.requestRender?.();
    });
    if (img) {
      ctx.drawImage(img, x, y, run.width, drawHeight);
    }
    return;
  }

  const originalFontSizePx = ptToPx(style.fontSize ?? theme.defaultFontSize);

  // Superscript/subscript: reduce font size to 60% and shift baseline
  const isSuperscript = style.superscript === true;
  const isSubscript = style.subscript === true;
  const renderFontSize = (isSuperscript || isSubscript)
    ? (style.fontSize ?? theme.defaultFontSize) * 0.6
    : style.fontSize;

  // Link defaults: blue text + underline (user-set values take precedence)
  let textColor = style.color || theme.defaultColor;
  let showUnderline = style.underline ?? false;
  if (style.href) {
    if (!style.color) textColor = '#1155cc';
    if (style.underline === undefined) showUnderline = true;
  }

  ctx.font = buildFont(
    renderFontSize,
    style.fontFamily,
    style.bold,
    style.italic,
  );
  ctx.fillStyle = textColor;
  ctx.textBaseline = 'alphabetic';

  let baselineY = Math.round(lineY + (lineHeight + originalFontSizePx * 0.8) / 2);
  if (isSuperscript) {
    baselineY -= Math.round(originalFontSizePx * 0.4);
  } else if (isSubscript) {
    baselineY += Math.round(originalFontSizePx * 0.2);
  }
  const x = Math.round(lineX + run.x);

  if (style.backgroundColor && !skipBackground) {
    ctx.save();
    ctx.fillStyle = style.backgroundColor;
    ctx.fillRect(x, lineY, run.width, lineHeight);
    ctx.restore();
    ctx.fillStyle = textColor;
  }

  ctx.fillText(run.text, x, baselineY);

  if (showUnderline) {
    const underlineY = baselineY + 2;
    ctx.beginPath();
    ctx.strokeStyle = textColor;
    ctx.lineWidth = 1;
    ctx.moveTo(x, underlineY);
    ctx.lineTo(x + run.width, underlineY);
    ctx.stroke();
  }

  if (style.strikethrough) {
    const renderFontSizePx = ptToPx(
      (isSuperscript || isSubscript)
        ? (style.fontSize ?? theme.defaultFontSize) * 0.6
        : (style.fontSize ?? theme.defaultFontSize),
    );
    const strikeY = Math.round(baselineY - renderFontSizePx * 0.3);
    ctx.beginPath();
    ctx.strokeStyle = textColor;
    ctx.lineWidth = 1;
    ctx.moveTo(x, strikeY);
    ctx.lineTo(x + run.width, strikeY);
    ctx.stroke();
  }
}

/**
 * Render a list marker (bullet or number) for a list-item block.
 * Extracted verbatim from `DocCanvas.renderListMarker` so DocCanvas
 * and slides' text-box renderer share the same marker glyphs and
 * baseline math.
 */
export function renderListMarker(
  ctx: CanvasRenderingContext2D,
  block: Block,
  lineY: number,
  lineHeight: number,
  markerX: number,
  markerText: string,
  theme: DocTheme = DefaultTheme,
): void {
  const fontSize = block.inlines[0]?.style.fontSize ?? theme.defaultFontSize;
  const fontSizePx = ptToPx(fontSize);
  const baselineY = Math.round(lineY + (lineHeight + fontSizePx * 0.8) / 2);
  ctx.font = buildFont(fontSize, block.inlines[0]?.style.fontFamily, false, false);
  ctx.fillStyle = block.inlines[0]?.style.color ?? theme.defaultColor;
  ctx.fillText(markerText, markerX, baselineY);
}
