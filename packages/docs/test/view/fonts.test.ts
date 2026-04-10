import { describe, it, expect } from 'vitest';
import { FontRegistry, resolveFontFamily } from '../../src/view/fonts.js';

describe('FontRegistry', () => {
  it('should resolve known Korean font to fallback chain', () => {
    expect(resolveFontFamily('맑은 고딕')).toBe("'Malgun Gothic', 'Noto Sans KR', sans-serif");
  });

  it('should resolve HY헤드라인M to Noto Sans KR fallback', () => {
    expect(resolveFontFamily('HY헤드라인M')).toBe("'Noto Sans KR', sans-serif");
  });

  it('should return standard fonts as-is with fallback', () => {
    expect(resolveFontFamily('Arial')).toBe("'Arial', sans-serif");
  });

  it('should return unknown fonts with generic fallback', () => {
    expect(resolveFontFamily('SomeRandomFont')).toBe("'SomeRandomFont', sans-serif");
  });

  it('should resolve 바탕 to serif chain', () => {
    expect(resolveFontFamily('바탕')).toBe("'Batang', 'Noto Serif KR', serif");
  });

  it('FontRegistry should report pending status for unknown font', () => {
    const registry = new FontRegistry();
    expect(registry.getFontStatus('Arial')).toBe('pending');
  });
});
