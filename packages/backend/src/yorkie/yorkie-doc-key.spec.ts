import {
  yorkieDocKeyPrefix,
  yorkieDocKey,
  parseYorkieDocKey,
} from './yorkie-doc-key';

describe('yorkie-doc-key', () => {
  it('maps each known type to its prefix', () => {
    expect(yorkieDocKeyPrefix('sheet')).toBe('sheet-');
    expect(yorkieDocKeyPrefix('doc')).toBe('doc-');
    expect(yorkieDocKeyPrefix('slides')).toBe('slides-');
  });

  it('reserves the pdf prefix (Phase 1: registered but unused)', () => {
    expect(yorkieDocKeyPrefix('pdf')).toBe('pdf-');
    expect(yorkieDocKey('pdf', 'abc')).toBe('pdf-abc');
  });

  it('throws for unknown types', () => {
    expect(() => yorkieDocKeyPrefix('bogus')).toThrow('Unknown document type');
  });
});

describe('parseYorkieDocKey', () => {
  it('round-trips every known type', () => {
    for (const type of ['sheet', 'doc', 'slides', 'pdf'] as const) {
      const id = 'a1b2-c3d4';
      expect(parseYorkieDocKey(yorkieDocKey(type, id))).toEqual({ type, id });
    }
  });

  it('keeps an id that itself contains a hyphen intact', () => {
    // Document ids are UUIDs (hyphen-rich); only the first prefix is stripped.
    expect(parseYorkieDocKey('slides-dc73f0ca-f267-441c-8ecb-8ed975515cf8')).toEqual(
      { type: 'slides', id: 'dc73f0ca-f267-441c-8ecb-8ed975515cf8' },
    );
  });

  it('returns null for an unknown prefix', () => {
    expect(parseYorkieDocKey('unknown-123')).toBeNull();
  });

  it('returns null for a bare prefix with no id', () => {
    expect(parseYorkieDocKey('sheet-')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseYorkieDocKey('')).toBeNull();
  });
});

describe('yorkie-doc-key notes', () => {
  it('builds a note- prefixed key', () => {
    expect(yorkieDocKey('note', 'abc')).toBe('note-abc');
    expect(yorkieDocKeyPrefix('note')).toBe('note-');
  });
  it('parses a note- key back to type note', () => {
    expect(parseYorkieDocKey('note-abc')).toEqual({ type: 'note', id: 'abc' });
  });
});

describe('yorkie-doc-key image prefix', () => {
  it('maps image to the image- prefix', () => {
    expect(yorkieDocKeyPrefix('image')).toBe('image-');
    expect(yorkieDocKey('image', 'abc')).toBe('image-abc');
  });

  it('round-trips an image key', () => {
    expect(parseYorkieDocKey('image-abc')).toEqual({ type: 'image', id: 'abc' });
  });

  it('still throws on an unknown type', () => {
    expect(() => yorkieDocKeyPrefix('bogus')).toThrow();
  });
});
