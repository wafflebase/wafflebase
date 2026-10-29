/**
 * Browser half of `render-slides.mjs`: exposes the editor's own offscreen
 * slide renderer (`renderSlideCanvas`, the call the left rail and the
 * template thumbnail make) to the Playwright driver — through the same
 * settle-until-images-load capture `wafflebase slides render` uses.
 */
import type { SlidesDocument } from "@wafflebase/slides";
import { createSlideRenderHook } from "../src/app/slides/slide-render-hook";

declare global {
  interface Window {
    __renderSlide?: (doc: SlidesDocument, index: number) => Promise<string | null>;
  }
}

window.__renderSlide = (doc, index) => createSlideRenderHook(() => doc).render(index);
