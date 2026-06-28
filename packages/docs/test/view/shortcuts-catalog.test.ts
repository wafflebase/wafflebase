import { describe, it, expect } from 'vitest';
import { SHORTCUTS, formatCombo } from '../../src/view/shortcuts-catalog';

describe('shortcuts catalog', () => {
  it('every entry has at least one non-empty key combo', () => {
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
      'Editing', 'Navigation', 'Format', 'Paragraph',
      'Find', 'Comments', 'History', 'Help',
    ]);
    for (const entry of SHORTCUTS) {
      expect(allowed.has(entry.category)).toBe(true);
    }
  });

  it('exposes every shortcut implemented in text-editor.ts (no catalog drift)', () => {
    const combos = new Set(SHORTCUTS.flatMap((s) => s.keys));
    // Heading 1–6
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(combos.has(`Mod+Alt+${level}`)).toBe(true);
    }
    // Apply format painter (paste formatting)
    expect(combos.has('Mod+Alt+V')).toBe(true);
    // Word-level caret movement + deletion
    expect(combos.has('WordMod+Arrow ←/→')).toBe(true);
    expect(combos.has('WordMod+Backspace')).toBe(true);
    expect(combos.has('WordMod+Delete')).toBe(true);
  });

  it('covers the high-visibility shortcuts', () => {
    const descriptions = SHORTCUTS.map((s) => s.description.toLowerCase());
    expect(descriptions.some((d) => d.includes('select all'))).toBe(true);
    expect(descriptions.some((d) => d.includes('bold'))).toBe(true);
    expect(descriptions.some((d) => d.includes('heading'))).toBe(true);
    expect(descriptions.some((d) => d.includes('page break'))).toBe(true);
    expect(descriptions.some((d) => d.includes('keyboard shortcuts'))).toBe(true);
  });
});

describe('formatCombo', () => {
  it('rewrites Mod to ⌘ on mac and Ctrl elsewhere', () => {
    expect(formatCombo('Mod+A', true)).toBe('⌘A');
    expect(formatCombo('Mod+A', false)).toBe('Ctrl+A');
  });

  it('combines modifiers correctly', () => {
    expect(formatCombo('Mod+Shift+X', true)).toBe('⌘⇧X');
    expect(formatCombo('Mod+Shift+X', false)).toBe('Ctrl+Shift+X');
    expect(formatCombo('Mod+Alt+1', true)).toBe('⌘⌥1');
    expect(formatCombo('Mod+Alt+1', false)).toBe('Ctrl+Alt+1');
  });

  it('rewrites WordMod to ⌥ on mac and Ctrl elsewhere', () => {
    expect(formatCombo('WordMod+Backspace', true)).toBe('⌥Backspace');
    expect(formatCombo('WordMod+Backspace', false)).toBe('Ctrl+Backspace');
  });

  it('preserves named keys', () => {
    expect(formatCombo('Arrow ←/→', true)).toBe('Arrow ←/→');
    expect(formatCombo('Enter', false)).toBe('Enter');
  });
});
