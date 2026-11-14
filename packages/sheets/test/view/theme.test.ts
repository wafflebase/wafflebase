import { describe, expect, it } from 'vitest';
import { palette } from '@wafflebase/core/tokens';
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
});
