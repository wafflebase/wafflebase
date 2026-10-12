/**
 * Browser half of `render-slides.mjs`: exposes the editor's own offscreen
 * slide renderer (`renderSlideCanvas`, the call the left rail and the
 * template thumbnail make) to the Playwright driver.
 */
import type { SlidesDocument } from "@wafflebase/slides";
import { renderSlideCanvas } from "../src/app/slides/slides-thumbnail";

declare global {
  interface Window {
    __renderSlide?: (doc: SlidesDocument, index: number) => Promise<string | null>;
  }
}

window.__renderSlide = async (doc, index) => {
  const canvas = await renderSlideCanvas(doc, index);
  return canvas ? canvas.toDataURL("image/png") : null;
};
