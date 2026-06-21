import { SLIDE_HEIGHT, SLIDE_WIDTH, type SlidesStore } from '@wafflebase/slides';

export interface InsertImageArgs {
  store: SlidesStore;
  slideId: string;
  file: File;
  upload: (file: File) => Promise<{ url: string; w: number; h: number }>;
}

/** Inserted images are capped at this fraction of the slide in each axis. */
const MAX_INSERT_RATIO = 0.8;

/**
 * Default frame for a freshly-inserted image. Aspect-preserved, capped
 * at 80 % of the slide (1920×1080 logical) in each dimension, and
 * centred. Images smaller than the cap keep their natural size 1:1 (no
 * upscaling), so what the user dropped in is what they see.
 *
 * Without the cap, a large source (e.g. a 3840×2160 screenshot) would
 * insert at natural size and spill off every edge of the slide.
 */
export function computeImageFrame(
  naturalWidth: number,
  naturalHeight: number,
): { x: number; y: number; w: number; h: number; rotation: number } {
  const maxW = SLIDE_WIDTH * MAX_INSERT_RATIO;
  const maxH = SLIDE_HEIGHT * MAX_INSERT_RATIO;
  // Guard against a non-finite or 0 natural dimension (a failed
  // preflight): collapse to a finite, centred 0×0 frame rather than
  // letting Infinity/NaN reach the CRDT. `Infinity > 0` is true but
  // `Infinity * scale` is Infinity/NaN, so a `> 0` check alone is not
  // enough — require finiteness too, and never multiply on the bad path.
  const valid =
    Number.isFinite(naturalWidth) &&
    Number.isFinite(naturalHeight) &&
    naturalWidth > 0 &&
    naturalHeight > 0;
  // Fit-inside scale (≤ 1); 1:1 when the image already fits the cap.
  const scale = valid ? Math.min(1, maxW / naturalWidth, maxH / naturalHeight) : 0;
  const w = valid ? naturalWidth * scale : 0;
  const h = valid ? naturalHeight * scale : 0;
  return {
    x: (SLIDE_WIDTH - w) / 2,
    y: (SLIDE_HEIGHT - h) / 2,
    w,
    h,
    rotation: 0,
  };
}

/**
 * Upload an image file, then insert an ImageElement centered on the
 * slide canvas (1920×1080 logical). Returns the new element id.
 *
 * Used by the toolbar Insert > Image button. Drag-drop and
 * clipboard-paste paths funnel through the same helper to avoid
 * three divergent insert paths.
 */
export async function insertImageOnSlide(args: InsertImageArgs): Promise<string> {
  const { url, w, h } = await args.upload(args.file);
  let elementId = '';
  args.store.batch(() => {
    elementId = args.store.addElement(args.slideId, {
      type: 'image',
      frame: computeImageFrame(w, h),
      data: { src: url },
    });
  });
  return elementId;
}
