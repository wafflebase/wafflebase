import type { FrameSize } from '../builder';

/**
 * `actionButtonDocument` glyph — folded-corner document outline.
 * Same shape language as the `foldedCorner` basic shape but
 * smaller and centred inside the action button body.
 */
export function buildDocumentGlyph({ w, h }: FrameSize): Path2D {
  const m = Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const fold = m * 0.1;
  const left = cx - m * 0.18;
  const right = cx + m * 0.18;
  const top = cy - m * 0.25;
  const bottom = cy + m * 0.25;
  const path = new Path2D();
  // Main outline with NE corner cut.
  path.moveTo(left, top);
  path.lineTo(right - fold, top);
  path.lineTo(right, top + fold);
  path.lineTo(right, bottom);
  path.lineTo(left, bottom);
  path.closePath();
  // Fold triangle in the NE corner.
  path.moveTo(right - fold, top);
  path.lineTo(right - fold, top + fold);
  path.lineTo(right, top + fold);
  path.closePath();
  return path;
}
