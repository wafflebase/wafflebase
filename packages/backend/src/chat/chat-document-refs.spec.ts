import {
  extractDocumentLinks,
  frontendBase,
  MAX_REFS_PER_MESSAGE,
  parseAnchor,
  toRefDtos,
} from './chat-document-refs';

const ID = '0b6f3c2e-8a4d-4f1e-9c7b-2d5e6f708192';
const ID2 = '1c7a4d3f-9b5e-4a2f-8d6c-3e4f5a607182';
const BASE = 'https://app.wafflebase.test';

function at(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

describe('frontendBase', () => {
  it('keeps origin and basename, trims the trailing slash', () => {
    expect(frontendBase('https://x.test/app/')).toBe('https://x.test/app');
    expect(frontendBase('http://localhost:5173')).toBe('http://localhost:5173');
  });

  it('refuses unset and non-http values', () => {
    expect(frontendBase(undefined)).toBeUndefined();
    expect(frontendBase('ftp://x.test')).toBeUndefined();
    expect(frontendBase('not a url')).toBeUndefined();
  });
});

describe('extractDocumentLinks', () => {
  it('reads an absolute URL on this frontend, for every editor route', () => {
    for (const p of ['s', 'd', 'p', 'n', 'b', 'f']) {
      expect(extractDocumentLinks(`see ${BASE}/${p}/${ID}`, BASE)).toEqual([
        { documentId: ID, at: null },
      ]);
    }
  });

  it('reads a root-relative path standing on its own', () => {
    expect(extractDocumentLinks(`/s/${ID}`, BASE)).toEqual([
      { documentId: ID, at: null },
    ]);
    expect(extractDocumentLinks(`(see /d/${ID})`, undefined)).toEqual([
      { documentId: ID, at: null },
    ]);
  });

  it('ignores another origin, and a path glued to other text', () => {
    expect(extractDocumentLinks(`https://evil.test/s/${ID}`, BASE)).toEqual([]);
    expect(extractDocumentLinks(`x/s/${ID}`, BASE)).toEqual([]);
    expect(
      extractDocumentLinks(`https://evil.test/${BASE}/s/${ID}`, BASE),
    ).toEqual([]);
    expect(extractDocumentLinks(`${BASE}.evil.test/s/${ID}`, BASE)).toEqual([]);
  });

  it('ignores an unknown route or a non-uuid id', () => {
    expect(extractDocumentLinks(`${BASE}/x/${ID}`, BASE)).toEqual([]);
    expect(extractDocumentLinks(`${BASE}/s/abc`, BASE)).toEqual([]);
    expect(extractDocumentLinks(`${BASE}/s/${ID}x`, BASE)).toEqual([]);
  });

  it('honors the basename', () => {
    const base = 'https://x.test/app';
    expect(extractDocumentLinks(`${base}/s/${ID}`, base)).toHaveLength(1);
    expect(extractDocumentLinks(`https://x.test/s/${ID}`, base)).toEqual([]);
  });

  it('takes ?at=, dropping trailing punctuation, and dedupes by document', () => {
    const a = at({ slideId: 'x' });
    expect(
      extractDocumentLinks(
        `${BASE}/p/${ID}?chat=c1&at=${a}. and ${BASE}/p/${ID} and /s/${ID2}`,
        BASE,
      ),
    ).toEqual([
      { documentId: ID, at: a },
      { documentId: ID2, at: null },
    ]);
  });

  it('lowercases ids and caps the count', () => {
    expect(extractDocumentLinks(`/s/${ID.toUpperCase()}`, BASE)).toEqual([
      { documentId: ID, at: null },
    ]);
    const many = Array.from(
      { length: MAX_REFS_PER_MESSAGE + 5 },
      (_, i) => `/s/${ID.slice(0, -4)}${String(1000 + i)}`,
    ).join(' ');
    expect(extractDocumentLinks(many, BASE)).toHaveLength(MAX_REFS_PER_MESSAGE);
  });
});

describe('parseAnchor', () => {
  const sheet = { tabId: 't', rowId: 'r', colId: 'c', rowSpan: 3, colSpan: 2 };

  it('keeps a well-formed anchor of the document type, and its label', () => {
    expect(parseAnchor(at(sheet), 'sheet')).toEqual(sheet);
    expect(
      parseAnchor(at({ ...sheet, label: 'Sheet1!C3:E7' }), 'sheet'),
    ).toEqual({ ...sheet, label: 'Sheet1!C3:E7' });
    expect(parseAnchor(at({ blockId: 'b', excerpt: 'hi' }), 'doc')).toEqual({
      blockId: 'b',
      excerpt: 'hi',
    });
    expect(parseAnchor(at({ slideId: 's', extra: 1 }), 'slides')).toEqual({
      slideId: 's',
    });
  });

  it('stores null for garbage, a mismatched type, or a type with no anchors', () => {
    expect(parseAnchor(null, 'sheet')).toBeNull();
    expect(parseAnchor('!!!', 'sheet')).toBeNull();
    expect(parseAnchor('bm90IGpzb24', 'sheet')).toBeNull(); // "not json"
    expect(parseAnchor(at([1, 2]), 'sheet')).toBeNull();
    expect(parseAnchor(at({ slideId: 's' }), 'sheet')).toBeNull();
    expect(parseAnchor(at({ ...sheet, rowSpan: 0 }), 'sheet')).toBeNull();
    expect(parseAnchor(at({ ...sheet, rowSpan: 1.5 }), 'sheet')).toBeNull();
    expect(
      parseAnchor(at({ blockId: 'b', excerpt: 'x'.repeat(201) }), 'doc'),
    ).toBeNull();
    expect(parseAnchor(at({ slideId: 's', label: 7 }), 'slides')).toBeNull();
    expect(parseAnchor(at(sheet), 'note')).toBeNull();
    expect(parseAnchor('A'.repeat(4000), 'sheet')).toBeNull();
  });
});

describe('toRefDtos', () => {
  it('drops a document that has moved to another workspace', () => {
    const row = (workspaceId: string) => ({
      documentId: ID,
      anchor: null,
      document: { type: 'sheet', title: 'Q4', workspaceId },
    });
    expect(toRefDtos([row('w1'), row('w2')], 'w1')).toEqual([
      { documentId: ID, type: 'sheet', title: 'Q4', anchor: null },
    ]);
    expect(toRefDtos(undefined, 'w1')).toEqual([]);
  });
});
