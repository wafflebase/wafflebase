import type { Stroke } from '@wafflebase/slides';
import { dashArray } from '@wafflebase/slides';

/** Drawn width of a preview line, in px. */
const PREVIEW_W = 64;

/**
 * Constant, so the menu keeps an even rhythm: sizing each row to its own
 * line would leave every weight below 16px at the same height and make
 * the last row alone jump. Tall enough to clear the thickest weight.
 */
const PREVIEW_H = 24;

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
 * The pattern comes from the renderer's own `dashArray()` — at the same
 * weight, so it cannot drift from what the slide canvas strokes. That is
 * the same guarantee `shape-picker` gets by previewing through
 * `renderShapeIcon`. SVG rather than canvas because `currentColor`
 * resolves natively here, which is exactly what canvas previews have to
 * work around.
 *
 * Both menus draw the real weight. The dash menu used to clamp it to
 * 3px because a fixed `[2,2]` at 16px read as a solid bar — but so did
 * the border it was previewing, so the clamp made the picker flattering
 * rather than accurate. Now that `dashArray` scales with the weight the
 * clamp is gone, and a thick dashed line previews as the long blocks it
 * really is.
 */
export function StrokePreview({ dash, width }: StrokePreviewProps) {
  const height = PREVIEW_H;
  const pattern = dashArray(dash, width);
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
