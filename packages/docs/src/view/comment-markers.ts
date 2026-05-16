/**
 * A range the editor should draw as a comment highlight. The `id` is an
 * opaque handle the caller maps back to its own data (typically a thread
 * id) when the user clicks the marker. The editor turns each marker
 * into one-or-more rectangles via the standard selection layout, so
 * markers automatically follow resize, zoom, and line-wrap changes.
 */
export interface CommentMarker {
  id: string;
  anchor: { blockId: string; offset: number };
  focus: { blockId: string; offset: number };
}

/**
 * A rectangle the editor has drawn. The id is propagated from the
 * source `CommentMarker` so the caller can resolve clicks back to a
 * thread. Owned by the canvas — callers should not synthesize these.
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
