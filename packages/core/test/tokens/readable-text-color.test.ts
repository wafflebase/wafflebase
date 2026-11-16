import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  readableTextColor,
  LABEL_TEXT_DARK,
  LABEL_TEXT_LIGHT,
} from '../../src/tokens';

// The sheets peer palettes (light + dark) that slides, docs and sheets
// paint collaborator name tags on. Copied rather than imported: core is a
// leaf package and must not depend on sheets.
const PEER_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FB7185', '#DDA0DD', '#98D8C8', '#A78BFA',
  '#FF7979', '#55EFC4', '#74B9FF', '#A4D4C4',
  '#E17055', '#81ECEC',
];

describe('readableTextColor', () => {
  it('puts dark text on a light background', () => {
    expect(readableTextColor('#81ECEC')).toBe(LABEL_TEXT_DARK);
    expect(readableTextColor('#FFFFFF')).toBe(LABEL_TEXT_DARK);
  });

  it('puts white text on a dark background', () => {
    expect(readableTextColor('#000000')).toBe(LABEL_TEXT_LIGHT);
    expect(readableTextColor('#1967D2')).toBe(LABEL_TEXT_LIGHT);
  });

  it('reads oklch backgrounds', () => {
    expect(readableTextColor('oklch(0.95 0.02 90)')).toBe(LABEL_TEXT_DARK);
    expect(readableTextColor('oklch(0.25 0.05 260)')).toBe(LABEL_TEXT_LIGHT);
  });

  it('falls back to white for a format it cannot parse', () => {
    expect(readableTextColor('rgb(0, 0, 0)')).toBe(LABEL_TEXT_LIGHT);
    expect(readableTextColor('#fff')).toBe(LABEL_TEXT_LIGHT);
  });

  it('meets AA (4.5:1) on every peer color', () => {
    for (const bg of PEER_COLORS) {
      const text = readableTextColor(bg);
      expect(contrastRatio(text, bg), bg).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('always picks the higher-contrast of the two', () => {
    for (const bg of [...PEER_COLORS, '#777777', '#767676', '#808080']) {
      const picked = contrastRatio(readableTextColor(bg), bg);
      expect(picked).toBeGreaterThanOrEqual(contrastRatio(LABEL_TEXT_DARK, bg));
      expect(picked).toBeGreaterThanOrEqual(contrastRatio(LABEL_TEXT_LIGHT, bg));
    }
  });
});
