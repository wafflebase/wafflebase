/**
 * Canonical mapping from persisted document `type` to the Yorkie document
 * key prefix. The frontend editors mirror these prefixes (see
 * `packages/frontend/src/app/docs/docs-detail.tsx`,
 * `packages/frontend/src/app/slides/slides-detail.tsx`, and the spreadsheet
 * entry in `packages/frontend/src/app/documents/document-detail.tsx`).
 *
 * Any new document type must be added here; an unknown type throws so the
 * mistake surfaces at request time instead of silently falling through to
 * a wrong key.
 */
export type DocumentTypeLike = 'sheet' | 'doc' | 'slides' | 'pdf';

export const YORKIE_DOC_KEY_PREFIXES = {
  sheet: 'sheet-',
  doc: 'doc-',
  slides: 'slides-',
  pdf: 'pdf-',
} as const;

export function yorkieDocKeyPrefix(type: string): string {
  switch (type) {
    case 'sheet':
      return YORKIE_DOC_KEY_PREFIXES.sheet;
    case 'doc':
      return YORKIE_DOC_KEY_PREFIXES.doc;
    case 'slides':
      return YORKIE_DOC_KEY_PREFIXES.slides;
    case 'pdf':
      return YORKIE_DOC_KEY_PREFIXES.pdf;
    default:
      throw new Error(`Unknown document type: ${type}`);
  }
}

export function yorkieDocKey(type: string, id: string): string {
  return `${yorkieDocKeyPrefix(type)}${id}`;
}
