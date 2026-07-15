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
});
