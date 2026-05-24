import { describe, expect, it } from 'vitest';
import { semantic, palette } from '../src';
import { contrastRatio } from '../src/contrast';

const AA_NORMAL = 4.5;
const AA_LARGE = 3.0;

describe('WCAG AA contrast', () => {
  it('foreground vs background passes AA in light mode', () => {
    const ratio = contrastRatio(semantic.light.foreground, semantic.light.background);
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('foreground vs background passes AA in dark mode', () => {
    const ratio = contrastRatio(semantic.dark.foreground, semantic.dark.background);
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('primary-foreground vs primary passes AA-large in both modes', () => {
    expect(
      contrastRatio(semantic.light.primaryForeground, semantic.light.primary),
    ).toBeGreaterThanOrEqual(AA_LARGE);
    expect(
      contrastRatio(semantic.dark.primaryForeground, semantic.dark.primary),
    ).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it('sidebar foreground vs sidebar background passes AA in both modes', () => {
    expect(
      contrastRatio(semantic.light.sidebarForeground, semantic.light.sidebar),
    ).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(
      contrastRatio(semantic.dark.sidebarForeground, semantic.dark.sidebar),
    ).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('butter chip text remains legible on butter background', () => {
    // butter is used as a header/chip background; dark ink sits on top of it.
    // light.ink is the warm dark brown used in light mode (#2A1E12).
    const ratio = contrastRatio(palette.neutrals.light.ink, palette.butter);
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});
