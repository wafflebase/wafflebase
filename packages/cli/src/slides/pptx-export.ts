import { exportPptx, type SlidesDocument } from '@wafflebase/slides/node';

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
  return exportPptx(deck, { fetchImage });
}
