/**
 * Browser half of `render-slides.mjs` and `render-thumbnails.mjs`.
 *
 * `__renderSlide` exposes the editor's own offscreen slide renderer
 * (`renderSlideCanvas`, the call the left rail and the template thumbnail
 * make) through the same settle-until-images-load capture
 * `wafflebase slides render` uses.
 *
 * `__renderThumbnail` produces a template gallery thumbnail from a seed's
 * content with the very functions the mounted editors register as their
 * thumbnail source, encoded by the same `encodeThumbnail` the Share dialog
 * uses — so an offline card is the 1280 px WebP a publish from the editor
 * would have uploaded.
 */
import type { SlidesDocument } from "@wafflebase/slides";
import { createSlideRenderHook } from "../src/app/slides/slide-render-hook";
import { renderDeckThumbnail } from "../src/app/slides/slides-thumbnail";
import {
  NOTE_THUMBNAIL_THEMES,
  renderNoteThumbnail,
} from "../src/app/notes/notes-thumbnail";
import { encodeThumbnail } from "../src/lib/thumbnail-capture";

/** A seed's content, as `pnpm backend template:dump` writes it. */
type SeedContent =
  | { kind: "slides"; document: SlidesDocument }
  | { kind: "note"; document: { content: string } }
  | { kind: string };

type ThumbnailResult =
  | { ok: true; dataUrl: string; mimeType: string }
  | { ok: false; unsupported: boolean; reason: string };

declare global {
  interface Window {
    __renderSlide?: (doc: SlidesDocument, index: number) => Promise<string | null>;
    __renderThumbnail?: (content: SeedContent) => Promise<ThumbnailResult>;
  }
}

window.__renderSlide = (doc, index) => createSlideRenderHook(() => doc).render(index);

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

window.__renderThumbnail = async (content) => {
  let canvas: HTMLCanvasElement | null;
  if (content.kind === "slides" && "document" in content) {
    canvas = await renderDeckThumbnail(content.document as SlidesDocument);
  } else if (content.kind === "note" && "document" in content) {
    // The light card, as `notes-view.tsx` registers it.
    canvas = renderNoteThumbnail(
      (content.document as { content: string }).content,
      NOTE_THUMBNAIL_THEMES.light,
    );
  } else {
    return {
      ok: false,
      unsupported: true,
      reason: `no model-driven thumbnail renderer for "${content.kind}" yet`,
    };
  }
  if (!canvas) return { ok: false, unsupported: false, reason: "nothing to render" };
  const blob = await encodeThumbnail(canvas);
  if (!blob) {
    return { ok: false, unsupported: false, reason: "the canvas could not be encoded" };
  }
  return { ok: true, dataUrl: await readAsDataUrl(blob), mimeType: blob.type };
};
