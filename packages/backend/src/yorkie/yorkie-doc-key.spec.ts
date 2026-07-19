import {
  yorkieDocKeyPrefix,
  yorkieDocKey,
  parseYorkieDocKey,
} from './yorkie-doc-key';

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
