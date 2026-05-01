import type { PDFDocument, PDFImage } from 'pdf-lib';
import type { Document, Block } from '../model/types.js';

export type ImageFetcher = (url: string) => Promise<Blob>;

export interface EmbeddedImage {
  embedded: PDFImage;
  width: number;
  height: number;
}

/**
 * Walk the document for image inlines, fetch each unique src, embed it
 * into the PDF, and return a `src → embedded image` map. The painter
 * looks up entries by `style.image.src` when drawing image runs.
 *
 * Throws if the document contains image inlines but no fetcher was
 * supplied — an exporter caller that doesn't pass an `imageFetcher`
 * cannot meaningfully embed images, and silently dropping them would
 * change the visual output without warning.
 *
 * pdf-lib only supports PNG and JPEG natively. GIF / WebP / BMP and
 * other Blob types are decoded via the browser Canvas API and
 * re-encoded as PNG before being embedded. That conversion path is
 * browser-only — Node/jsdom callers that hit a non-PNG/JPEG src will
 * get a clear error.
 */
export async function collectAndEmbedImages(
  doc: Document,
  pdfDoc: PDFDocument,
  fetcher?: ImageFetcher,
): Promise<Map<string, EmbeddedImage>> {
  const out = new Map<string, EmbeddedImage>();
  const srcs = new Set<string>();
  collectSrcs(doc.blocks, srcs);
  if (doc.header) collectSrcs(doc.header.blocks, srcs);
  if (doc.footer) collectSrcs(doc.footer.blocks, srcs);
  if (srcs.size === 0) return out;
  if (!fetcher) {
    throw new Error(
      'imageFetcher required: document contains image inlines',
    );
  }

  for (const src of srcs) {
    const blob = await fetcher(src);
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // `Blob.type` is empty when the response lacked a Content-Type
    // header — common for static asset hosts and direct file fetches.
    // Fall back to magic-byte sniffing so real PNG/JPEG payloads don't
    // get routed through the browser-only Canvas conversion path.
    const mime = (blob.type || sniffImageMime(bytes) || '').toLowerCase();
    let img: PDFImage;
    if (mime === 'image/png') {
      img = await pdfDoc.embedPng(bytes);
    } else if (mime === 'image/jpeg' || mime === 'image/jpg') {
      img = await pdfDoc.embedJpg(bytes);
    } else {
      img = await embedAsPng(pdfDoc, buf, mime || 'image/png');
    }
    out.set(src, { embedded: img, width: img.width, height: img.height });
  }
  return out;
}

/**
 * Detect PNG and JPEG payloads by inspecting their magic-byte signatures.
 * Returns undefined for anything else, which falls through to the Canvas
 * conversion path (or fails there in non-browser environments).
 */
function sniffImageMime(bytes: Uint8Array): string | undefined {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 &&
    bytes[2] === 0x4e && bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  // JPEG (any flavor): FF D8 FF
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  return undefined;
}

/**
 * Browser-only fallback for non-PNG/JPEG mime types. Loads the blob
 * via an `Image` element, draws it onto an off-screen canvas, then
 * re-encodes the canvas as PNG so pdf-lib can embed it. In Node/jsdom
 * (no DOM Canvas) this throws — tests should stick to PNG/JPEG.
 */
async function embedAsPng(
  pdfDoc: PDFDocument,
  buf: ArrayBuffer,
  mime: string,
): Promise<PDFImage> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new Error(
      `Image format ${mime} requires a DOM Canvas to convert; ` +
      `not available in this environment`,
    );
  }
  const blob = new Blob([buf], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const cctx = canvas.getContext('2d');
    if (!cctx) {
      throw new Error('Canvas 2D context unavailable for image conversion');
    }
    cctx.drawImage(img, 0, 0);
    const pngBlob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => {
        if (b) resolve(b);
        else reject(new Error('canvas.toBlob returned null'));
      }, 'image/png');
    });
    return pdfDoc.embedPng(new Uint8Array(await pngBlob.arrayBuffer()));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Recurse into table cells so images inside cells are also collected.
 * Image src is dedup'd by the caller's `Set`; the same image used in
 * multiple inlines is fetched and embedded only once.
 */
function collectSrcs(blocks: Block[], out: Set<string>): void {
  for (const block of blocks) {
    if (block.tableData) {
      for (const row of block.tableData.rows) {
        for (const cell of row.cells) {
          if (cell.blocks) collectSrcs(cell.blocks, out);
        }
      }
    }
    for (const inline of block.inlines) {
      if (inline.style.image?.src) out.add(inline.style.image.src);
    }
  }
}
