import { hasPendingImageLoads, type SlidesDocument } from "@wafflebase/slides";
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
  /**
   * Slide `index` (0-based) as a PNG data URL, or null if unrenderable: no
   * such slide, a third-party image tainted the canvas, or an image was still
   * loading when the settle timeout ran out.
   */
  render(index: number): Promise<string | null>;
}

declare global {
  interface Window {
    __wafflebaseSlideRender?: SlideRenderHook;
  }
}

export interface SlideRenderHookDeps {
  render?: (
    doc: SlidesDocument,
    index: number,
  ) => Promise<{ toDataURL(type: string): string } | null>;
  pendingImages?: () => boolean;
  /** Longest a slide may wait for its images before the capture gives up. */
  settleTimeoutMs?: number;
  pollMs?: number;
}

/**
 * Paint, and repaint until no image is still loading.
 * `renderSlideCanvas` waits one short window for late assets, which suits a
 * gallery thumbnail; a capture the user asked for must not encode a slide
 * whose image has not arrived yet. Past the timeout it reports the slide as
 * unrenderable rather than returning a PNG with a hole in it.
 */
async function renderSettled(
  doc: SlidesDocument,
  index: number,
  deps: Required<SlideRenderHookDeps>,
) {
  const deadline = Date.now() + deps.settleTimeoutMs;
  for (;;) {
    const canvas = await deps.render(doc, index);
    if (!canvas || !deps.pendingImages()) return canvas;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, deps.pollMs));
  }
}

export function createSlideRenderHook(
  read: () => SlidesDocument | null,
  deps: SlideRenderHookDeps = {},
): SlideRenderHook {
  const resolved: Required<SlideRenderHookDeps> = {
    render: renderSlideCanvas,
    pendingImages: hasPendingImageLoads,
    settleTimeoutMs: 20_000,
    pollMs: 200,
    ...deps,
  };
  return {
    count: () => read()?.slides?.length ?? 0,
    async render(index) {
      const doc = read();
      if (!doc) return null;
      const canvas = await renderSettled(doc, index, resolved);
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
