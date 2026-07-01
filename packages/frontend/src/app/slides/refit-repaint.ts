/**
 * Repaint decision for the slides canvas after a viewport refit.
 *
 * `refitCanvas` reassigns `canvas.width` / `canvas.height` on every size
 * change, which resets the backing store to transparent (the "black
 * slide" symptom). The redraw after that clear is delegated to
 * `editor.setHostSize` and `editor.setSlideOffset`, each of which
 * early-returns without repainting when its own inputs are unchanged.
 *
 * There is exactly one frame where the bitmap is wiped yet neither
 * setter repaints it: the pasteboard-canvas size changed while the
 * fitted-slide (host) size AND the slide offset both stayed the same —
 * common at Fit zoom when the slide is height-constrained or
 * `MAX_HOST_W`-clamped, so a right-pane resize (e.g. the global sidebar
 * collapsing) shifts only the surrounding pasteboard band. On that frame
 * the caller must force a repaint itself, otherwise the cleared canvas
 * stays black until an unrelated event re-dirties the renderer.
 */
export interface RefitChangeFlags {
  /** The canvas backing-store size changed (so the bitmap was cleared). */
  canvasChanged: boolean;
  /** The fitted-slide (host) size changed (so `setHostSize` repainted). */
  hostChanged: boolean;
  /** The centered slide offset changed (so `setSlideOffset` repainted). */
  offsetChanged: boolean;
}

/**
 * True when the refit cleared the backing store but neither the host
 * size nor the offset changed — the only case where `setHostSize` /
 * `setSlideOffset` both no-op and the caller must repaint explicitly.
 */
export function needsForcedRepaintAfterRefit({
  canvasChanged,
  hostChanged,
  offsetChanged,
}: RefitChangeFlags): boolean {
  return canvasChanged && !hostChanged && !offsetChanged;
}
