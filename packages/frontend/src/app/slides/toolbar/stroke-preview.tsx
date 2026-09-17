import type { Stroke } from '@wafflebase/slides';
import { dashArray } from '@wafflebase/slides';

/** Drawn width of a preview line, in px. */
const PREVIEW_W = 64;

/**
 * A dash pattern is only legible on a reasonably thin line — `[2,2]`
 * stroked at 16px reads as a solid bar. The dash menu therefore clamps
 * the weight it previews; the weight menu, which *is* about thickness,
 * draws the real value.
 */
const DASH_PREVIEW_MAX_WEIGHT = 3;

export interface StrokePreviewProps {
  /** Dash style to draw. Absent / `'solid'` ⇒ a continuous line. */
  dash?: Stroke['dash'];
  /** Line thickness in px. */
  width: number;
}

/**
 * A single horizontal line drawn with a stroke's dash pattern and
 * weight, for the border toolbar's dropdown items.
 *
 * The pattern comes from the renderer's own `dashArray()`, so the
 * preview cannot drift from what the slide canvas strokes — the same
 * guarantee `shape-picker` gets by previewing through `renderShapeIcon`.
 * SVG rather than canvas because `currentColor` resolves natively here,
 * which is exactly what canvas previews have to work around.
 */
export function StrokePreview({ dash, width }: StrokePreviewProps) {
  // Leave a px of air above and below the thickest line so a 16px
  // preview is not clipped by its own viewBox.
  const height = Math.max(16, width + 8);
  const pattern = dashArray(dash);
  return (
    <svg
      width={PREVIEW_W}
      height={height}
      viewBox={`0 0 ${PREVIEW_W} ${height}`}
      // The menu item squashes every descendant `<svg>` to `size-4` so
      // bare icons line up — `[&_svg:not([class*='size-'])]:size-4` in
      // `dropdown-menu.tsx`. This is a preview, not an icon; a 16×16 box
      // would crush the line and strand it at the item's left edge. The
      // rule's own opt-out is carrying a `size-` class, and `size-auto`
      // says exactly what we mean: take the intrinsic width/height above.
      className="size-auto"
      aria-hidden="true"
      focusable="false"
    >
      <line
        x1={0}
        y1={height / 2}
        x2={PREVIEW_W}
        y2={height / 2}
        stroke="currentColor"
        strokeWidth={width}
        // An empty `stroke-dasharray` is not a valid value; omit the
        // attribute entirely for a continuous line.
        strokeDasharray={pattern.length ? pattern.join(' ') : undefined}
      />
    </svg>
  );
}

/** {@link StrokePreview} at the clamped weight the dash menu uses. */
export function DashPreview({ dash, width }: StrokePreviewProps) {
  return <StrokePreview dash={dash} width={Math.min(width, DASH_PREVIEW_MAX_WEIGHT)} />;
}
