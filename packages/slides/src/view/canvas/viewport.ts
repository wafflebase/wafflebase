/** A pan/zoom transform mapping world (logical px) → screen (CSS px). */
export interface Viewport {
  /** Screen-px x offset applied after zoom. */
  panX: number;
  /** Screen-px y offset applied after zoom. */
  panY: number;
  /** World px → screen px scale. */
  zoom: number;
}

/** world → screen: s = w * zoom + pan */
export function worldToScreen(
  v: Viewport,
  p: { x: number; y: number },
): { x: number; y: number } {
  return { x: p.x * v.zoom + v.panX, y: p.y * v.zoom + v.panY };
}

/** screen → world: w = (s - pan) / zoom */
export function screenToWorld(
  v: Viewport,
  p: { x: number; y: number },
): { x: number; y: number } {
  return { x: (p.x - v.panX) / v.zoom, y: (p.y - v.panY) / v.zoom };
}
