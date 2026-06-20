import type { ShapeElement, ShapeKind } from '../../model/element';
import { resolveColor, type Theme } from '../../model/theme';
import { drawActionButton } from './shape-special';
import { resolveStrokeColor } from './render-context';
import { PATH_BUILDERS } from './shapes';
import { isActionButton } from './shapes/action-buttons';
import type { FrameSize } from './shapes/builder';
import { buildFreeformPath } from './shapes/freeform';
import { paintTextBody } from './text-renderer';

export type { FrameSize } from './shapes/builder';

/**
 * Insets (in deck-canvas px at the default 1920×1080 size) applied when
 * painting a shape's `data.text`. Mirrors PowerPoint's default
 * `<a:bodyPr lIns="91440" tIns="45720">` — 0.1" / 0.05" — converted at
 * the deck scale (91440 EMU × 1920 / 12192000 EMU = 14.4 px;
 * 45720 EMU × 1920 / 12192000 EMU = 7.2 px). These match what an
 * unmodified shape in PowerPoint / Google Slides shows so inserted
 * shapes look right out of the box.
 *
 * Exported so the editor's `enterEditMode` can inset the in-place
 * text-box editing frame by the same amount — the user's caret and
 * glyphs while editing land where the committed paint will, without
 * a visible "shift" on commit.
 */
export const SHAPE_TEXT_PADDING = { x: 14.4, y: 7.2 } as const;

const placeholderWarned = new Set<string>();

/**
 * Shape kinds whose path geometry depends on the `evenodd` fill rule.
 * The dispatcher passes `'evenodd'` to `ctx.fill(path, ...)` for these
 * kinds so concentric counter-clockwise sub-paths punch holes (donut)
 * rather than filling the whole interior. `noSmoking` also relies on
 * even-odd because its inner holes are C-shaped sub-paths whose CCW
 * winding would otherwise need real winding-rule support to register
 * as holes in the JSDOM test shim.
 */
export const EVENODD_KINDS: ReadonlySet<ShapeKind> = new Set([
  'donut',
  'noSmoking',
]);

/**
 * Shape kinds whose `PathBuilder` returns an open (un-`closePath`'d)
 * polyline. Stroking traces just the visible outline as intended,
 * but `ctx.fill()` auto-closes the path with a straight line —
 * producing a misleading filled shape (e.g. an open `leftBracket`
 * fills as a C-rect rather than a thin bracket outline).
 *
 * Brackets and braces are the only such kinds today: OOXML defines
 * them with separate fill / stroke paths that we collapse into a
 * single stroke-oriented polyline. Real-world PPTX usage is
 * overwhelmingly `<a:noFill/>` (the user-supplied Yorkie deck has
 * stroke-only brackets), but a future deck with a filled bracket
 * would silently render incorrectly without this guard.
 */
export const OPEN_PATH_KINDS: ReadonlySet<ShapeKind> = new Set([
  'leftBracket',
  'rightBracket',
  'leftBrace',
  'rightBrace',
  'bracketPair',
  'bracePair',
]);

/**
 * Draw a shape's geometry (fill + stroke / action-button body) into
 * element-local coordinates (top-left at 0,0). The caller is
 * responsible for the frame transform (translate + rotate + flip) AND
 * for calling `paintShapeText` separately — text painting is split out
 * so the caller can wrap it in a counter-flip transform to keep glyphs
 * readable when the shape is flipped (PowerPoint / Google Slides
 * behavior).
 *
 * Action buttons are special-cased (body + glyph). All other kinds
 * resolve through PATH_BUILDERS; unknown kinds fall back to a
 * placeholder rectangle so the slide always renders.
 */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  size: FrameSize,
  data: ShapeElement['data'],
  theme: Theme,
): void {
  if (isActionButton(data.kind)) {
    drawActionButton(ctx, size, data, theme);
    return;
  }

  // Freeform (`<a:custGeom>`) — geometry is data-driven, not parametric.
  // Fall back to a placeholder rect if the path is somehow missing so the
  // slide still renders something at the frame. Filled with the default
  // nonzero winding rule, matching PowerPoint's custGeom rendering.
  if (data.kind === 'freeform') {
    if (!data.path) {
      drawPlaceholderRect(ctx, size, data, theme);
      return;
    }
    paintFillStroke(ctx, buildFreeformPath(size, data.path), data, theme);
    return;
  }

  const builder = PATH_BUILDERS.get(data.kind);
  if (!builder) {
    if (!placeholderWarned.has(data.kind)) {
      placeholderWarned.add(data.kind);
      console.warn(
        `slides: no path builder registered for shape kind "${data.kind}"; ` +
          `falling back to placeholder rect`,
      );
    }
    drawPlaceholderRect(ctx, size, data, theme);
    return;
  }
  paintFillStroke(ctx, builder(size, data.adjustments), data, theme, {
    skipFill: OPEN_PATH_KINDS.has(data.kind),
    fillRule: EVENODD_KINDS.has(data.kind) ? 'evenodd' : 'nonzero',
  });
}

/**
 * Paint a path's fill + stroke from a shape's `data`, the one place that
 * maps `data.fill`/`data.stroke` onto the canvas for every Path2D-based
 * kind (parametric and freeform). `skipFill` suppresses the auto-closing
 * fill for open-path kinds (brackets/braces); `fillRule` selects even-odd
 * winding for kinds with real holes (donut/noSmoking). Round joins keep
 * concave corners (e.g. plus / mathPlus inner notches) from sprouting
 * miter spikes.
 */
function paintFillStroke(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  data: ShapeElement['data'],
  theme: Theme,
  opts?: { skipFill?: boolean; fillRule?: CanvasFillRule },
): void {
  if (data.fill && !opts?.skipFill) {
    ctx.fillStyle = resolveColor(data.fill, theme);
    ctx.fill(path, opts?.fillRule ?? 'nonzero');
  }
  if (data.stroke) {
    ctx.strokeStyle = resolveStrokeColor(data.stroke.color, theme);
    ctx.lineWidth = data.stroke.width;
    ctx.lineJoin = 'round';
    ctx.stroke(path);
  }
}

function drawPlaceholderRect(
  ctx: CanvasRenderingContext2D,
  { w, h }: FrameSize,
  data: ShapeElement['data'],
  theme: Theme,
): void {
  if (data.fill) {
    ctx.fillStyle = resolveColor(data.fill, theme);
    ctx.fillRect(0, 0, w, h);
  }
  if (data.stroke) {
    ctx.strokeStyle = resolveStrokeColor(data.stroke.color, theme);
    ctx.lineWidth = data.stroke.width;
    ctx.strokeRect(0, 0, w, h);
  }
}

/**
 * Paint a shape's optional inline text body on top of its fill/stroke,
 * using PowerPoint-default insets and a `'middle'` vertical anchor
 * default (matches what PowerPoint / Google Slides do when a shape is
 * created and the user types into it without changing alignment).
 *
 * No-op when `data.text` is absent. Exported so `element-renderer` can
 * orchestrate the geometry → text paint sequence and wrap text in a
 * counter-flip transform.
 */
export function paintShapeText(
  ctx: CanvasRenderingContext2D,
  size: FrameSize,
  data: ShapeElement['data'],
  theme: Theme,
  fontScale?: number,
): void {
  if (!data.text) return;
  paintTextBody(ctx, size, data.text, theme, {
    padding: SHAPE_TEXT_PADDING,
    defaultVerticalAnchor: 'middle',
    fontScale,
  });
}
