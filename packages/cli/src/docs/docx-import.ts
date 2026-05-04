import './dom-polyfill.js';
import {
  DocxImporter,
  type Document,
  type ImageUploader,
} from '@wafflebase/docs';

/**
 * Default `ImageUploader` for the CLI: encodes each image inline as a
 * `data:` URL. The Yorkie store treats inline-image `src` values as
 * opaque strings, so a self-contained data URL round-trips cleanly
 * without needing a backend image upload endpoint.
 *
 * The MIME type is derived from the filename's extension (matching what
 * `DocxImporter` infers from `.rels` content types). Unknown
 * extensions fall back to `application/octet-stream` — pdf-lib /
 * browser image rendering will refuse to display those, but at least
 * the document round-trip stays lossless at the JSON layer.
 */
export const inlineBase64Uploader: ImageUploader = async (blob, filename) => {
  const arrayBuf = await blob.arrayBuffer();
  const base64 = Buffer.from(arrayBuf).toString('base64');
  const mime = blob.type || mimeFromFilename(filename) || 'application/octet-stream';
  return `data:${mime};base64,${base64}`;
};

function mimeFromFilename(filename: string): string | undefined {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return undefined;
  const ext = filename.slice(dot + 1).toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    default:
      return undefined;
  }
}

export interface CliDocxImportOptions {
  /** Override the default base64 uploader — primarily for tests. */
  imageUploader?: ImageUploader;
}

/**
 * Parse a .docx byte buffer into a `Document` using the editor's
 * `DocxImporter`. The polyfill side-effect import at the top of this
 * file installs `DOMParser` from `@xmldom/xmldom` so the importer's
 * browser-targeted XML parsing works in Node.
 *
 * Throws a wrapped `INVALID_DOCX` error when the underlying importer
 * cannot make sense of the buffer (missing `word/document.xml`,
 * malformed XML, unsupported zip layout). The CLI command translates
 * the wrapper into the documented `{ error.code: 'INVALID_DOCX' }`
 * exit body without leaking implementation details.
 */
export async function importDocx(
  buf: Uint8Array,
  opts: CliDocxImportOptions = {},
): Promise<Document> {
  const arrayBuf = buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;
  try {
    return await DocxImporter.import(
      arrayBuf,
      opts.imageUploader ?? inlineBase64Uploader,
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new InvalidDocxError(message);
  }
}

export class InvalidDocxError extends Error {
  readonly code = 'INVALID_DOCX';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDocxError';
  }
}
