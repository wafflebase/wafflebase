import type { ShapeElement, ShapeKind } from '../../model/element';
import { resolveColor, type Theme } from '../../model/theme';
import { drawActionButton } from './shape-special';
import { resolveStrokeColor } from './render-context';
import { PATH_BUILDERS } from './shapes';
import { isActionButton } from './shapes/action-buttons';
import type { FrameSize } from './shapes/builder';

export type { FrameSize } from './shapes/builder';

const placeholderWarned = new Set<string>();

/**
 * Shape kinds whose path geometry depends on the `evenodd` fill rule.
 * The dispatcher passes `'evenodd'` to `ctx.fill(path, ...)` for these
 * kinds so concentric counter-clockwise sub-paths punch holes (donut)
 * rather than filling the whole interior.
 */
export const EVENODD_KINDS: ReadonlySet<ShapeKind> = new Set(['donut']);

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
]);

/**
 * Draw a shape into element-local coordinates (top-left at 0,0). The
 * caller is responsible for the frame transform (translate + rotate).
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
    return drawActionButton(ctx, size, data, theme);
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
  const path = builder(size, data.adjustments);
  if (data.fill && !OPEN_PATH_KINDS.has(data.kind)) {
    ctx.fillStyle = resolveColor(data.fill, theme);
    ctx.fill(path, EVENODD_KINDS.has(data.kind) ? 'evenodd' : 'nonzero');
  }
  if (data.stroke) {
    ctx.strokeStyle = resolveStrokeColor(data.stroke.color, theme);
    ctx.lineWidth = data.stroke.width;
    // Round joins so concave corners (e.g. plus / mathPlus inner
    // notches) don't sprout miter spikes that look like a small
    // square at the cross's centre.
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
