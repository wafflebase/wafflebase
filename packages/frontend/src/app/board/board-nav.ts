import type { Viewport } from "@wafflebase/board";
import type { FitInsets } from "./fit-insets";

/**
 * The board's viewport, as the floating board-local tools (find, export)
 * see it. Built once by `BoardView`'s mount effect around its single
 * viewport chokepoint (`commitViewport`), so a tool that moves the view
 * goes through the same path a pan does — the renderer, minimap, grid and
 * zoom readout all follow.
 */
export interface BoardNav {
  getViewport(): Viewport;
  getHost(): { w: number; h: number };
  /** Chrome floating over the host that framing must avoid. */
  getInsets(): FitInsets;
  commit(next: Viewport): void;
  /** Called after every committed viewport, by any path. */
  subscribe(cb: (vp: Viewport) => void): () => void;
}

/** A tiny multicast for "the viewport just changed". */
export interface ViewportSignal {
  emit(vp: Viewport): void;
  subscribe(cb: (vp: Viewport) => void): () => void;
}

export function createViewportSignal(): ViewportSignal {
  const subs = new Set<(vp: Viewport) => void>();
  return {
    emit: (vp) => {
      for (const cb of subs) cb(vp);
    },
    subscribe: (cb) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
  };
}
