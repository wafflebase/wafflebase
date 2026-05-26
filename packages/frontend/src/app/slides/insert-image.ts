import type { SlidesStore } from '@wafflebase/slides';

export interface InsertImageArgs {
  store: SlidesStore;
  slideId: string;
  file: File;
  upload: (file: File) => Promise<{ url: string; w: number; h: number }>;
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
      frame: {
        x: (1920 - w) / 2,
        y: (1080 - h) / 2,
        w,
        h,
        rotation: 0,
      },
      data: { src: url },
    });
  });
  return elementId;
}
