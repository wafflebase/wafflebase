import type { ShapeKind } from '../../model/element';
import type { FrameSize } from './shapes/builder';
import { PATH_BUILDERS } from './shapes';
import { ACTION_BUTTON_GLYPHS, isActionButton } from './shapes/action-buttons';

const STROKE_WIDTH = 1.0;
const PADDING = 1;

/**
 * For picker-icon rendering of callouts, fall back to the bubble
 * shape only — the tail and the small thought-bubble circles do not
 * fit at 24×24 and make the preview unrecognizable. The proxy maps
 * each callout to its closest "bubble-only" basic shape; the slide
 * canvas still renders the full callout (tail + bubbles) at full
 * size unchanged.
 */
const CALLOUT_BUBBLE_PROXY: Partial<Record<ShapeKind, ShapeKind>> = {
  wedgeRectCallout: 'rect',
  wedgeRoundRectCallout: 'roundRect',
  wedgeEllipseCallout: 'ellipse',
  cloudCallout: 'cloud',
};

/**
 * Paint a shape outline at icon size into the supplied context. Used
 * by the toolbar's Shape ▾ picker so previews track geometry from
 * `PATH_BUILDERS` without a separate icon asset. Caller is expected to
 * have set `ctx.strokeStyle` to currentColor (or the desired colour)
 * before calling.
 */
export function renderShapeIcon(
  kind: ShapeKind,
  ctx: CanvasRenderingContext2D,
  size: FrameSize,
): void {
  const inset = PADDING + STROKE_WIDTH / 2;
  const w = Math.max(0, size.w - inset * 2);
  const h = Math.max(0, size.h - inset * 2);
  ctx.save();
  try {
    ctx.translate(inset, inset);
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineJoin = 'round';
    if (isActionButton(kind)) {
      // Action buttons aren't in PATH_BUILDERS — `drawActionButton`
      // handles the slide-canvas paint via the body + glyph pair.
      // For the picker icon we stroke a small body rectangle and
      // overlay the per-kind glyph (when one exists) so each
      // button is visually distinguishable at 24 × 24 px. Use
      // moveTo/lineTo (instead of `ctx.rect`) because the harness
      // shim doesn't implement `rect` directly.
      const inset = Math.min(w, h) * 0.06;
      const x0 = inset;
      const y0 = inset;
      const x1 = w - inset;
      const y1 = h - inset;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x0, y1);
      ctx.lineTo(x0, y0);
      ctx.stroke();
      const glyphBuilder = ACTION_BUTTON_GLYPHS.get(kind);
      if (glyphBuilder) {
        const glyph = glyphBuilder({ w, h });
        ctx.stroke(glyph);
      }
      return;
    }
    const iconKind = CALLOUT_BUBBLE_PROXY[kind] ?? kind;
    const builder = PATH_BUILDERS.get(iconKind);
    if (!builder) return;
    const path = builder({ w, h }, undefined);
    ctx.stroke(path);
  } finally {
    ctx.restore();
  }
}
