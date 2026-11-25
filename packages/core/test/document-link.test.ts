import { describe, expect, it } from 'vitest';
import {
  decodeAnchor,
  DOCUMENT_PATH_SOURCE,
  DOCUMENT_ROUTE_LETTERS,
  documentRoute,
  encodeAnchor,
  MAX_ANCHOR_EXCERPT,
  MAX_ANCHOR_LABEL,
  MAX_ANCHOR_PARAM,
  MAX_ANCHOR_SPAN,
  parseDocumentPath,
  validateAnchor,
} from '../src/document-link/index.ts';

const ID = '0b6f3c2e-8a4d-4f1e-9c7b-2d5e6f708192';

// Core carries no `@types/node`; vitest runs under Node, which has it.
declare const Buffer: {
  from(s: string, enc: string): { toString(enc: string): string };
};

/** What the backend used to decode with: Node's own base64url. */
function nodeAt(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

describe('document routes', () => {
  it('maps every type to its editor route letter', () => {
    expect(documentRoute('sheet')).toBe('s');
    expect(documentRoute('doc')).toBe('d');
    expect(documentRoute('slides')).toBe('p');
    expect(documentRoute('note')).toBe('n');
    expect(documentRoute('board')).toBe('b');
    expect(documentRoute('pdf')).toBe('f');
    expect(documentRoute('image')).toBe('f');
    expect(documentRoute('file')).toBe('f');
  });

  it('answers null for an unknown type, including inherited keys', () => {
    expect(documentRoute('spreadsheet')).toBeNull();
    expect(documentRoute('toString')).toBeNull();
    expect(documentRoute('')).toBeNull();
  });

  it('lists each letter once', () => {
    expect([...DOCUMENT_ROUTE_LETTERS].sort()).toEqual([
      'b',
      'd',
      'f',
      'n',
      'p',
      's',
    ]);
  });
});

describe('parseDocumentPath', () => {
  it('reads every route and lowercases the id', () => {
    for (const r of DOCUMENT_ROUTE_LETTERS) {
      expect(parseDocumentPath(`/${r}/${ID}`)).toEqual({
        route: r,
        documentId: ID,
      });
    }
    expect(parseDocumentPath(`/s/${ID.toUpperCase()}/`)?.documentId).toBe(ID);
  });

  it('refuses other routes, non-uuid ids, and deeper paths', () => {
    expect(parseDocumentPath(`/w/${ID}`)).toBeNull();
    expect(parseDocumentPath('/s/abc')).toBeNull();
    expect(parseDocumentPath(`/s/${ID}x`)).toBeNull();
    expect(parseDocumentPath(`/s/${ID}/edit`)).toBeNull();
    expect(parseDocumentPath(`/app/s/${ID}`)).toBeNull();
  });

  it('exposes an embeddable source with route and id groups', () => {
    const m = new RegExp(DOCUMENT_PATH_SOURCE).exec(`see /d/${ID}?at=x`);
    expect(m?.[1]).toBe('d');
    expect(m?.[2]).toBe(ID);
  });
});

describe('encodeAnchor / decodeAnchor', () => {
  const sheet = { tabId: 't', rowId: 'r', colId: 'c', rowSpan: 3, colSpan: 2 };

  it('is unpadded base64url and round-trips UTF-8', () => {
    const anchor = { blockId: 'b1', excerpt: '한국어 text?/+' };
    const raw = encodeAnchor(anchor);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeAnchor(raw, 'doc')).toEqual(anchor);
  });

  it("agrees with Node's base64url in both directions", () => {
    const anchor = { blockId: 'b', excerpt: '日本語 ±', label: 'x' };
    expect(encodeAnchor(anchor)).toBe(nodeAt(anchor));
    expect(decodeAnchor(nodeAt(anchor), 'doc')).toEqual(anchor);
  });

  it('keeps a well-formed anchor of the document type, and its label', () => {
    expect(decodeAnchor(nodeAt(sheet), 'sheet')).toEqual(sheet);
    expect(
      decodeAnchor(nodeAt({ ...sheet, label: 'Sheet1!C3:E7' }), 'sheet'),
    ).toEqual({ ...sheet, label: 'Sheet1!C3:E7' });
    expect(decodeAnchor(nodeAt({ slideId: 's', extra: 1 }), 'slides')).toEqual({
      slideId: 's',
    });
  });

  it('rejects garbage, the wrong shape, and values past the limits', () => {
    expect(decodeAnchor(null, 'sheet')).toBeNull();
    expect(decodeAnchor(undefined, 'sheet')).toBeNull();
    expect(decodeAnchor('', 'sheet')).toBeNull();
    expect(decodeAnchor('!!!', 'sheet')).toBeNull();
    expect(decodeAnchor('%%%', 'sheet')).toBeNull();
    expect(decodeAnchor('bm90IGpzb24', 'sheet')).toBeNull(); // "not json"
    expect(decodeAnchor('A', 'sheet')).toBeNull(); // not a base64 length
    expect(decodeAnchor(nodeAt([1, 2]), 'sheet')).toBeNull();
    expect(decodeAnchor(nodeAt(null), 'sheet')).toBeNull();
    expect(decodeAnchor(nodeAt({ slideId: 's' }), 'sheet')).toBeNull();
    expect(decodeAnchor(nodeAt({ ...sheet, rowSpan: 0 }), 'sheet')).toBeNull();
    expect(
      decodeAnchor(nodeAt({ ...sheet, rowSpan: 1.5 }), 'sheet'),
    ).toBeNull();
    expect(
      decodeAnchor(nodeAt({ ...sheet, colSpan: MAX_ANCHOR_SPAN + 1 }), 'sheet'),
    ).toBeNull();
    expect(
      decodeAnchor(
        nodeAt({ blockId: 'b', excerpt: 'x'.repeat(MAX_ANCHOR_EXCERPT + 1) }),
        'doc',
      ),
    ).toBeNull();
    expect(
      decodeAnchor(
        nodeAt({ slideId: 's', label: 'x'.repeat(MAX_ANCHOR_LABEL + 1) }),
        'slides',
      ),
    ).toBeNull();
    expect(
      decodeAnchor(nodeAt({ slideId: 's', label: 7 }), 'slides'),
    ).toBeNull();
    expect(decodeAnchor(nodeAt({ slideId: '' }), 'slides')).toBeNull();
    expect(decodeAnchor(nodeAt(sheet), 'note')).toBeNull();
    expect(decodeAnchor('A'.repeat(MAX_ANCHOR_PARAM + 4), 'sheet')).toBeNull();
  });

  it('rejects bytes that are not UTF-8', () => {
    // 0xff 0xfe is no UTF-8 sequence.
    expect(decodeAnchor('__4', 'doc')).toBeNull();
  });
});

describe('validateAnchor', () => {
  it('validates an already-parsed value by the same rule', () => {
    expect(validateAnchor({ blockId: 'b', excerpt: 'hi' }, 'doc')).toEqual({
      blockId: 'b',
      excerpt: 'hi',
    });
    expect(validateAnchor('b', 'doc')).toBeNull();
    expect(validateAnchor({ blockId: 'b' }, 'sheet')).toBeNull();
  });
});
