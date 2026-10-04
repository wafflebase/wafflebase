import type { SlidesDocument } from "@wafflebase/slides";
import { renderSlideCanvas } from "./slides-thumbnail";

/**
 * Programmatic per-slide capture for `wafflebase slides render`.
 *
 * The CLI drives a headless browser to the deck's editor route (the same
 * approach as `register:templates`) and, once the editor has mounted, asks
 * this hook for each slide as a full-resolution PNG. The pixels come from
 * `renderThumbnail`, the renderer the editor's own rail uses, at the deck's
 * logical size (1920 wide) — not a downscaled thumbnail.
 */
export interface SlideRenderHook {
  /** Number of slides in the loaded deck; 0 until the deck has loaded. */
  count(): number;
  /** Slide `index` (0-based) as a PNG data URL, or null if unrenderable. */
  render(index: number): Promise<string | null>;
}

declare global {
  interface Window {
    __wafflebaseSlideRender?: SlideRenderHook;
  }
}

export function createSlideRenderHook(
  read: () => SlidesDocument | null,
): SlideRenderHook {
  return {
    count: () => read()?.slides?.length ?? 0,
    async render(index) {
      const doc = read();
      if (!doc) return null;
      const canvas = await renderSlideCanvas(doc, index);
      if (!canvas) return null;
      try {
        return canvas.toDataURL("image/png");
      } catch {
        // Tainted by a third-party image: unreadable, so report it as such.
        return null;
      }
    },
  };
}

/** Install the hook on `window`; returns the removal. */
export function installSlideRenderHook(
  read: () => SlidesDocument | null,
): () => void {
  const hook = createSlideRenderHook(read);
  window.__wafflebaseSlideRender = hook;
  return () => {
    if (window.__wafflebaseSlideRender === hook) {
      delete window.__wafflebaseSlideRender;
    }
  };
}
