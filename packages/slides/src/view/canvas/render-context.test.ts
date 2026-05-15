import { describe, it, expect } from 'vitest';
import type { Theme } from '../../model/theme';
import { resolveStrokeColor } from './render-context';

const THEME: Theme = {
  id: 't',
  name: 't',
  colors: {
    text: '#000000',
    background: '#ffffff',
    textSecondary: '#444444',
    backgroundAlt: '#f3f3f3',
    accent1: '#FF9900',
    accent2: '#00AAEE',
    accent3: '#33CC33',
    accent4: '#CC3333',
    accent5: '#9966CC',
    accent6: '#666666',
    hyperlink: '#1155CC',
    visitedHyperlink: '#7733AA',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
};

describe('resolveStrokeColor', () => {
  it('returns plain string colors unchanged', () => {
    expect(resolveStrokeColor('#ff0000', THEME)).toBe('#ff0000');
  });

  it('resolves ThemeColor srgb objects via resolveColor', () => {
    expect(resolveStrokeColor({ kind: 'srgb', value: '#abcdef' }, THEME)).toBe('#abcdef');
  });

  it('resolves ThemeColor role objects via the active theme', () => {
    expect(resolveStrokeColor({ kind: 'role', role: 'accent1' }, THEME)).toBe('#FF9900');
  });
});
