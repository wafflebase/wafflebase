import type { SlidesStore } from '@wafflebase/slides';

export interface ReplaceImageArgs {
  store: SlidesStore;
  slideId: string;
  elementId: string;
  file: File;
  upload: (file: File) => Promise<{ url: string; w: number; h: number }>;
}

/**
 * Upload a new image file and replace an existing ImageElement's src.
 * Crop is cleared because the new image has different bounds. The frame
 * position/size stays unchanged so the user's layout is preserved; they
 * can resize after replace.
 */
export async function replaceImageOnSlide(args: ReplaceImageArgs): Promise<void> {
  const { url } = await args.upload(args.file);
  args.store.batch(() => {
    args.store.updateElementData(args.slideId, args.elementId, {
      src: url,
      crop: undefined,
    });
  });
}
