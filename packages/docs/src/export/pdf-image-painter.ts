import type { Document } from '../model/types.js';
import type { PDFDocument } from 'pdf-lib';

export type ImageFetcher = (url: string) => Promise<Blob>;

export interface EmbeddedImage {
  embedded: unknown;
  width: number;
  height: number;
}

/**
 * Phase 5 will replace this stub. For now, returns an empty map so
 * exports without images work.
 */
export async function collectAndEmbedImages(
  _doc: Document,
  _pdfDoc: PDFDocument,
  _fetcher?: ImageFetcher,
): Promise<Map<string, EmbeddedImage>> {
  return new Map();
}
