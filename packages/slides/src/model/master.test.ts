import { describe, it, expect } from 'vitest';
import { DEFAULT_MASTER, type PlaceholderStyle } from './master';

describe('DEFAULT_MASTER', () => {
  it('has the canonical id and themeId', () => {
    expect(DEFAULT_MASTER.id).toBe('default');
    expect(DEFAULT_MASTER.themeId).toBe('default-light');
  });

  it('has title and body placeholder styles', () => {
    const styles = DEFAULT_MASTER.placeholderStyles;
    expect(styles.title).toBeDefined();
    expect(styles.body).toBeDefined();
    expect(styles.title.fontRole).toBe('heading');
    expect(styles.body.fontRole).toBe('body');
  });

  it('has a background fill that resolves to a theme role', () => {
    expect(DEFAULT_MASTER.background.fill).toEqual({ kind: 'role', role: 'background' });
  });

  it('placeholder styles bind colors by role', () => {
    const ps: PlaceholderStyle = DEFAULT_MASTER.placeholderStyles.title;
    expect(ps.colorRole).toBe('text');
  });
});
