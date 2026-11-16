import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  palette,
  readableTextColor,
} from '@wafflebase/core/tokens';
import { DarkTheme, LightTheme } from '../../src/view/theme';

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
