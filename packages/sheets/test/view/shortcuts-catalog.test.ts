import { describe, expect, it } from 'vitest';
import { SHORTCUTS, formatCombo } from '../../src/view/shortcuts-catalog';

const has = (combo: string) =>
  SHORTCUTS.some((entry) => entry.keys.includes(combo));

describe('sheets shortcuts catalog', () => {
  it('lists the Google-parity bindings the grid ships', () => {
    for (const combo of [
      'Mod+D',
      'Mod+R',
      'F2',
      'Shift+Space',
      'Ctrl+Space',
    ]) {
      expect(has(combo), combo).toBe(true);
    }
  });

  it('renders a literal Ctrl as the control key on macOS', () => {
    expect(formatCombo('Ctrl+Space', true)).toBe('⌃Space');
    expect(formatCombo('Ctrl+Space', false)).toBe('Ctrl+Space');
    expect(formatCombo('Mod+D', true)).toBe('⌘D');
  });
});
