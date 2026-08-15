import { exportPptx, type SlidesDocument } from '@wafflebase/slides/node';
import { reportSkippedImage } from '../docs/image-fetcher.js';

export interface CliPptxExportOptions {
  /** Blob-returning fetcher (the CLI's shared image fetcher). */
  imageFetcher?: (url: string) => Promise<Blob>;
}

export async function exportPptxCli(
  deck: SlidesDocument,
  opts: CliPptxExportOptions = {},
): Promise<Uint8Array> {
  const fetchImage = opts.imageFetcher
    ? async (src: string) => {
        const blob = await opts.imageFetcher!(src);
        return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || 'image/png' };
      }
    : undefined;
  // Same bargain the CLI's docs exports make: behind the SSRF guard a refused
  // or unreachable image is an ordinary outcome, so it is reported and the
  // deck still exports rather than one `src` costing the whole file.
  return exportPptx(deck, { fetchImage, onImageError: reportSkippedImage });
}
