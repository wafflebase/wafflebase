import { yorkieDocKeyPrefix, yorkieDocKey } from './yorkie-doc-key';

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
