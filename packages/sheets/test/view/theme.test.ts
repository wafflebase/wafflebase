import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  palette,
  readableTextColor,
} from '@wafflebase/core/tokens';
import {
  DarkTheme,
  LightTheme,
  getCellTextColor,
} from '../../src/view/theme';

/**
 * Chrome colors come from the core palette (DESIGN.md, the Canvas Hex Rule).
 * A stock Google blue used to frame the filter range — a second accent in the
 * grid, beside the syrup active cell.
 */
describe('sheets theme', () => {
  it('frames the filter range in syrup, the one accent', () => {
    expect(LightTheme.filterRangeBorderColor).toBe(palette.syrup);
    expect(DarkTheme.filterRangeBorderColor).toBe(palette.syrupBright);
  });

  it('paints cell links in the shared link color', () => {
    expect(LightTheme.cellLinkColor).toBe(palette.link);
    expect(DarkTheme.cellLinkColor).toBe(palette.linkBright);
  });

  // Sheets, docs and slides paint collaborator name tags on these colors
  // with `readableTextColor` text. That helper only guarantees the better
  // of near-black and white — mid-tones can miss AA — so the palette
  // itself is what has to keep every tag at 4.5:1. Reads the live theme,
  // so a new or retuned peer color is checked where it is defined.
  it('keeps every peer cursor color at AA with its label text', () => {
    for (const [name, theme] of [['light', LightTheme], ['dark', DarkTheme]] as const) {
      const peers = Object.entries(theme).filter(([k]) => k.startsWith('peerCursor'));
      expect(peers.length, name).toBeGreaterThan(0);
      for (const [key, bg] of peers) {
        const ratio = contrastRatio(readableTextColor(bg), bg);
        expect(ratio, `${name}.${key} ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('getCellTextColor', () => {
  const light = LightTheme.cellTextColor;
  const dark = DarkTheme.cellTextColor;

  it('follows the theme for an unfilled cell', () => {
    expect(getCellTextColor('light', light, undefined)).toBe(light);
    expect(getCellTextColor('dark', dark, undefined)).toBe(dark);
  });

  it('keeps the authored ink on any fill in light mode', () => {
    // Google Sheets parity: a dark fill keeps black text unless tc says not.
    expect(getCellTextColor('light', light, '#1155CC')).toBe(light);
  });

  it('puts the authored ink on a pale fill in dark mode', () => {
    expect(getCellTextColor('dark', dark, '#B7E1CD')).toBe(light);
    expect(getCellTextColor('dark', dark, '#ffe')).toBe(light);
    expect(getCellTextColor('dark', dark, 'rgba(255, 242, 204, 1)')).toBe(
      light,
    );
  });

  it('keeps the dark ink on a dark fill in dark mode', () => {
    expect(getCellTextColor('dark', dark, '#1155CC')).toBe(dark);
    expect(getCellTextColor('dark', dark, '#000000')).toBe(dark);
  });

  it('falls back to the theme ink for a fill it cannot read', () => {
    expect(getCellTextColor('dark', dark, 'transparent')).toBe(dark);
  });

  it('lets an explicit text color win', () => {
    expect(getCellTextColor('dark', dark, '#B7E1CD', '#FF0000')).toBe(
      '#FF0000',
    );
  });
});
