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

/**
 * Shrink a dash pattern, in proportion, until two whole cycles fit in the
 * preview box.
 *
 * `dashArray` scales with the stroke weight — at 16px, `'dashed'` is
 * `[96, 64]`, whose first dash alone is longer than this 64px line, so it
 * paints solid. Scaling the whole cycle keeps the dash:gap ratio that
 * distinguishes "Dashed" from "Dotted" while guaranteeing a visible gap;
 * clamping the weight instead would misreport the line's thickness, and
 * cropping only the first dash would misreport the ratio. Patterns that
 * already repeat (every weight up to 3px) are returned untouched.
 */
function fitPattern(pattern: number[]): number[] {
  const cycle = pattern.reduce((sum, n) => sum + n, 0);
  const max = PREVIEW_W / 2;
  if (cycle <= max) return pattern;
  return pattern.map((n) => (n * max) / cycle);
}

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
 * weight, so its shape cannot drift from what the slide canvas strokes.
 * That is the same guarantee `shape-picker` gets by previewing through
 * `renderShapeIcon`. SVG rather than canvas because `currentColor`
 * resolves natively here, which is exactly what canvas previews have to
 * work around.
 *
 * Both menus draw the real weight. The dash menu used to clamp that
 * weight to 3px, which made the picker flattering rather than accurate —
 * a 16px dashed border really does read as long blocks. So the line is
 * stroked at its true weight and only the *pattern* is bounded, by
 * {@link fitPattern}: a preview is 64px of a line that is 960px wide on
 * the slide, and a pattern too long to repeat inside it would show no
 * gap at all, making "Dashed" indistinguishable from "Solid".
 */
export function StrokePreview({ dash, width }: StrokePreviewProps) {
  const height = PREVIEW_H;
  const pattern = fitPattern(dashArray(dash, width));
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
