import { describe, expect, it } from 'vitest';
import { semantic } from '../../src/tokens/semantic';
import { contrastRatio } from '../../src/tokens/contrast';

/** WCAG AA floor for normal-size text — the bar `semantic.ts` cites. */
const AA_NORMAL = 4.5;

describe('semantic tokens', () => {
  it('exposes a light and dark map with identical keys', () => {
    const lightKeys = Object.keys(semantic.light).sort();
    const darkKeys = Object.keys(semantic.dark).sort();
    expect(darkKeys).toEqual(lightKeys);
  });

  it('every value is a valid CSS color string', () => {
    const re = /^(#[0-9A-Fa-f]{6}|oklch\(.+\)|rgba?\(.+\)|var\(--[a-z-]+\))$/;
    for (const map of [semantic.light, semantic.dark]) {
      for (const [key, value] of Object.entries(map)) {
        expect(value, `${key}=${value}`).toMatch(re);
      }
    }
  });

  it('exposes the keys consumed by the frontend @theme block', () => {
    const required = [
      'background',
      'foreground',
      'primary',
      'primaryForeground',
      'secondary',
      'secondaryForeground',
      'muted',
      'mutedForeground',
      'accent',
      'accentForeground',
      'destructive',
      'warning',
      'border',
      'input',
      'ring',
      'card',
      'cardForeground',
      'popover',
      'popoverForeground',
      'sidebar',
      'sidebarForeground',
      'sidebarPrimary',
      'sidebarPrimaryForeground',
      'sidebarAccent',
      'sidebarAccentForeground',
      'sidebarBorder',
      'sidebarRing',
    ];
    for (const key of required) {
      expect(semantic.light).toHaveProperty(key);
      expect(semantic.dark).toHaveProperty(key);
    }
  });

  /**
   * `warning` is the one token whose two values are not the same hue at two
   * lightnesses. No *colour at all* clears 4.5:1 on both `background` values
   * — the best a single value can do against #ffffff and #09090b is 4.46:1
   * (derivation in `semantic.ts`) — so the light and dark entries were chosen
   * independently. A future edit that "tidies" them into one shared value
   * would silently drop one theme under the WCAG AA floor, and no amount of
   * hue-hunting would fix it, so pin that they differ.
   */
  it('gives warning a distinct value per theme', () => {
    expect(semantic.light.warning).not.toBe(semantic.dark.warning);
  });

  /**
   * The assertion above only pins that the two values *differ* — two equally
   * illegible values would satisfy it. This is the one that holds for the
   * reason the comment gives: each status colour clears the AA floor against
   * the `background` of its own theme.
   *
   * It also subsumes the "they differ" pin. Since no single value can clear
   * 4.5:1 on both backgrounds (ceiling 4.46:1, derived in `semantic.ts`),
   * collapsing `warning` into one shared value must fail one of these two
   * themes — which is exactly the regression the pin was reaching for.
   *
   * Compared against the `background` **token** rather than a literal, so
   * retuning a background is caught here instead of silently invalidating a
   * hardcoded expectation.
   */
  it.each(['warning', 'destructive'] as const)(
    '%s clears WCAG AA against the background of both themes',
    (token) => {
      for (const theme of ['light', 'dark'] as const) {
        const ratio = contrastRatio(
          semantic[theme][token],
          semantic[theme].background,
        );
        expect(
          ratio,
          `${theme}.${token} on ${theme}.background`,
        ).toBeGreaterThanOrEqual(AA_NORMAL);
      }
    },
  );
});
