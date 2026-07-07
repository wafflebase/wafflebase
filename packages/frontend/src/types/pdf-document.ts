import type { PdfRegionAnchor, Thread } from '@/types/comments.ts';

/**
 * Yorkie document root for a PDF document. It holds ONLY comment threads —
 * the PDF bytes live in the blob store and are served by
 * `GET /documents/:id/file`. `comments` is seeded empty at bootstrap so
 * concurrent first-comment inserts merge instead of racing to create the
 * container (Yorkie resolves same-key object assignment by LWW).
 */
export type YorkiePdfRoot = {
  comments?: { [threadId: string]: Thread<PdfRegionAnchor> };
};

export function initialPdfRoot(): Partial<YorkiePdfRoot> {
  return { comments: {} };
}
