/**
 * A rectangle the editor draws as a comment highlight. The `id` is an
 * opaque handle the caller can map back to its own data (typically a
 * thread id) when the user clicks the marker.
 */
export interface HighlightRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Return the id of the rect under (x, y), or null when no rect contains
 * the point. Edges follow the canvas convention: left/top inclusive,
 * right/bottom exclusive. When rects overlap, the LAST rect in the list
 * wins so freshly-added threads take precedence over older ones at the
 * same hit point.
 */
export function findMarkerAt(
  rects: ReadonlyArray<HighlightRect>,
  x: number,
  y: number,
): string | null {
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i];
    if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) {
      return r.id;
    }
  }
  return null;
}
