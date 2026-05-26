import '../docs/dom-polyfill.js';
import {
  importPptx as importPptxFromSlides,
  type ImportPptxResult,
  type UploadImage,
} from '@wafflebase/slides/node';

/**
 * Default `UploadImage` for the CLI: encodes each embedded image as a
 * `data:` URL. Matches the docs CLI's `inlineBase64Uploader` — the
 * frontend treats slide image `src` values as opaque strings, so a
 * self-contained data URL round-trips cleanly through the API and
 * renders without needing the workspace's `/images` endpoint.
 *
 * The trade-off is payload size: a benchmark deck with 25 unique
 * images and 63 references gains roughly the image-byte total to the
 * Yorkie document. Acceptable for a v1 CLI import — power users who
 * want hosted URLs can pass a custom uploader.
 */
export const inlineBase64SlidesUploader: UploadImage = async (bytes, mime) => {
  const base64 = Buffer.from(bytes).toString('base64');
  const mediaType = mime || 'application/octet-stream';
  return `data:${mediaType};base64,${base64}`;
};

export interface CliPptxImportOptions {
  /** Override the default base64 uploader — primarily for tests. */
  uploadImage?: UploadImage;
}

/**
 * Parse a .pptx byte buffer into a `SlidesDocument` via the slides
 * parser. The DOM polyfill side-effect import installs xmldom's
 * `DOMParser` globally so the parser's browser-targeted XML reads work
 * in Node.
 *
 * Throws a wrapped `INVALID_PPTX` error when the underlying parser
 * cannot make sense of the buffer. The CLI command translates that
 * into the documented `{ error.code: 'INVALID_PPTX' }` exit body
 * without leaking implementation details.
 */
export async function importPptx(
  buf: Uint8Array,
  opts: CliPptxImportOptions = {},
): Promise<ImportPptxResult> {
  const arrayBuf = buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;
  try {
    return await importPptxFromSlides(arrayBuf, {
      uploadImage: opts.uploadImage ?? inlineBase64SlidesUploader,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new InvalidPptxError(message);
  }
}

export class InvalidPptxError extends Error {
  readonly code = 'INVALID_PPTX';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPptxError';
  }
}
