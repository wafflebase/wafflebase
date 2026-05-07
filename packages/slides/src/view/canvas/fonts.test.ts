import { describe, it, expect } from 'vitest';
import { resolveSlideFontFamily } from './fonts';

describe('resolveSlideFontFamily', () => {
  it('returns the slides default chain when no family is supplied', () => {
    expect(resolveSlideFontFamily()).toBe('Inter, system-ui, sans-serif');
    expect(resolveSlideFontFamily(undefined)).toBe('Inter, system-ui, sans-serif');
  });

  it('routes Korean font names through the docs registry to Noto Sans KR', () => {
    // Without this routing the Canvas paint string would be `'맑은 고딕'`
    // alone — when that face is missing on the host (e.g. macOS) Canvas
    // can have no Korean glyphs to fall back to. The docs registry adds
    // `'Noto Sans KR', sans-serif` as an explicit chain entry.
    expect(resolveSlideFontFamily('맑은 고딕')).toBe(
      "'Malgun Gothic', 'Noto Sans KR', sans-serif",
    );
    expect(resolveSlideFontFamily('HY헤드라인M')).toBe("'Noto Sans KR', sans-serif");
  });

  it('quotes unknown families and appends a generic fallback', () => {
    expect(resolveSlideFontFamily('Arial')).toBe("'Arial', sans-serif");
    expect(resolveSlideFontFamily('Times New Roman')).toBe(
      "'Times New Roman', serif",
    );
  });
});
