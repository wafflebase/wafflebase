import {
  type Viewport,
  worldToScreen,
  screenToWorld,
} from '@wafflebase/slides';

export { type Viewport, worldToScreen, screenToWorld };

export const DEFAULT_VIEWPORT: Viewport = { panX: 0, panY: 0, zoom: 1 };

/** Zoom about a screen anchor so the world point under it stays fixed. */
export function zoomAt(
  v: Viewport,
  screenPt: { x: number; y: number },
  factor: number,
  min = 0.1,
  max = 8,
): Viewport {
  const zoom = Math.min(max, Math.max(min, v.zoom * factor));
  // Keep worldPt fixed: screenPt = worldPt*zoom + pan  →  pan = screenPt - worldPt*zoom
  const worldPt = screenToWorld(v, screenPt);
  return {
    zoom,
    panX: screenPt.x - worldPt.x * zoom,
    panY: screenPt.y - worldPt.y * zoom,
  };
}

export function panBy(v: Viewport, dxScreen: number, dyScreen: number): Viewport {
  return { ...v, panX: v.panX + dxScreen, panY: v.panY + dyScreen };
}
