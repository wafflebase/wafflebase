import { describe, expect, it } from 'vitest';
import { semantic } from '../../src/tokens/semantic';

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
});
