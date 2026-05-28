import { describe, it, expect } from 'vitest';
import { SHORTCUTS, formatCombo } from '../../../src/view/editor/shortcuts-catalog';

describe('shortcuts catalog', () => {
  it('every entry has at least one key combo', () => {
    for (const entry of SHORTCUTS) {
      expect(entry.keys.length).toBeGreaterThan(0);
      for (const combo of entry.keys) {
        expect(combo).not.toBe('');
      }
    }
  });

  it('every entry has a non-empty description', () => {
    for (const entry of SHORTCUTS) {
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it('every entry uses a known category', () => {
    const allowed = new Set([
      'Selection', 'Slide', 'Clipboard', 'Z-order', 'Nudge',
      'Format', 'Present', 'Help', 'Drag',
    ]);
    for (const entry of SHORTCUTS) {
      expect(allowed.has(entry.category)).toBe(true);
    }
  });

  it('covers the high-visibility shortcuts shipped in this pass', () => {
    const descriptions = SHORTCUTS.map((s) => s.description.toLowerCase());
    expect(descriptions.some((d) => d.includes('select all'))).toBe(true);
    expect(descriptions.some((d) => d.includes('cycle'))).toBe(true);
    expect(descriptions.some((d) => d.includes('add a new slide'))).toBe(true);
    expect(descriptions.some((d) => d.includes('previous / next slide'))).toBe(true);
    expect(descriptions.some((d) => d.includes('start presentation from the current'))).toBe(true);
    expect(descriptions.some((d) => d.includes('keyboard shortcuts'))).toBe(true);
  });
});

describe('formatCombo', () => {
  it('rewrites Mod to ⌘ on mac and Ctrl elsewhere', () => {
    expect(formatCombo('Mod+A', true)).toBe('⌘A');
    expect(formatCombo('Mod+A', false)).toBe('Ctrl+A');
  });

  it('preserves named keys', () => {
    expect(formatCombo('Page Up', true)).toBe('Page Up');
    expect(formatCombo('Esc', false)).toBe('Esc');
  });

  it('combines modifiers correctly', () => {
    expect(formatCombo('Mod+Shift+D', true)).toBe('⌘⇧D');
    expect(formatCombo('Mod+Shift+D', false)).toBe('Ctrl+Shift+D');
  });
});
