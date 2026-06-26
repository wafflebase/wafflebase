import { describe, it, expect } from 'vitest';
import { BUILT_IN_THEMES, MemSlidesStore } from '@wafflebase/slides';
import {
  applyBuiltInTheme,
  isThemeModified,
} from '@/app/slides/theme-panel-helpers.ts';

function activeTheme(store: MemSlidesStore) {
  const doc = store.read();
  return doc.themes.find((t) => t.id === doc.meta.themeId)!;
}
const LIGHT = BUILT_IN_THEMES.find((t) => t.id === 'default-light')!;

/**
 * The theme panel itself is a React component rendered in the browser
 * bundle. The panel's behaviour-under-test (the batched addTheme +
 * applyTheme call wired to each thumbnail) is extracted into
 * `applyBuiltInTheme` and tested here against MemSlidesStore directly,
 * without rendering React.
 *
 * MemSlidesStore and YorkieSlidesStore implement the same SlidesStore
 * interface; the equivalence test
 * (`yorkie-slides-equivalence.test.ts`) covers the Yorkie path, so
 * exercising the helper through MemSlidesStore is enough for theme
 * panel coverage.
 */

describe('ThemePanel — applyBuiltInTheme helper', () => {
  it('exposes exactly twenty-three built-in themes (panel surface contract)', () => {
    // The panel renders one thumbnail per built-in theme, so the count
    // here is the same number the user sees in the picker. If a future
    // PR adds/removes a theme, this test fails as a forcing function
    // to update the panel snapshot/screenshot in the same change.
    expect(BUILT_IN_THEMES.length).toBe(23);
    expect(BUILT_IN_THEMES.map((t) => t.id)).toEqual([
      'default-light', 'default-dark', 'streamline', 'swiss', 'paradigm',
      'material', 'shift', 'momentum', 'focus', 'luxe', 'modern-writer',
      'coral', 'spearmint', 'pop', 'tropic', 'marina', 'geometric', 'plum',
      'slate', 'forest', 'spotlight', 'beach-day', 'wafflebase',
    ]);
  });

  it('applying a built-in theme sets meta.themeId', () => {
    const store = new MemSlidesStore();
    expect(store.read().meta.themeId).toBe('default-light');
    applyBuiltInTheme(store, 'material');
    expect(store.read().meta.themeId).toBe('material');
  });

  it('addTheme + applyTheme are batched into one undo entry', () => {
    const store = new MemSlidesStore();
    applyBuiltInTheme(store, 'focus');
    expect(store.read().meta.themeId).toBe('focus');
    // Single undo should revert BOTH the addTheme and the applyTheme,
    // not just one of them — proving they share a batch.
    expect(store.canUndo()).toBeTruthy();
    store.undo();
    expect(store.read().meta.themeId).toBe('default-light');
    // Theme list also reverted (back to just the seed default-light).
    expect(store.read().themes.map((t) => t.id)).toEqual(['default-light']);
  });

  it('applying an already-active theme is idempotent on themes[]', () => {
    const store = new MemSlidesStore();
    applyBuiltInTheme(store, 'streamline');
    applyBuiltInTheme(store, 'streamline');
    const themes = store.read().themes;
    // 'streamline' should appear exactly once even though we applied it twice
    expect(themes.filter((t) => t.id === 'streamline').length).toBe(1);
  });

  it('throws on unknown built-in theme id', () => {
    const store = new MemSlidesStore();
    expect(() => applyBuiltInTheme(store, 'no-such-theme')).toThrow(/unknown built-in theme/);
  });

  it('every BUILT_IN_THEME applies cleanly through the helper', () => {
    // Smoke-fence against future themes that are missing required
    // colors/fonts and would break addTheme/applyTheme.
    for (const t of BUILT_IN_THEMES) {
      const store = new MemSlidesStore();
      applyBuiltInTheme(store, t.id);
      expect(store.read().meta.themeId).toBe(t.id);
    }
  });
});

describe('theme customization (model A — in-place edit, re-pick resets)', () => {
  it('re-picking the active edited theme resets it to the built-in', () => {
    const store = new MemSlidesStore();
    applyBuiltInTheme(store, 'default-light');
    store.batch(() =>
      store.updateTheme('default-light', { colors: { accent1: '#abcdef' } }),
    );
    expect(activeTheme(store).colors.accent1).toBe('#abcdef');
    applyBuiltInTheme(store, 'default-light'); // re-pick → reset
    expect(activeTheme(store).colors.accent1).toBe(LIGHT.colors.accent1);
  });

  it('switching away and back resets the edited theme', () => {
    const store = new MemSlidesStore();
    applyBuiltInTheme(store, 'default-light');
    store.batch(() =>
      store.updateTheme('default-light', { fonts: { heading: 'Comic Sans' } }),
    );
    applyBuiltInTheme(store, 'material');
    applyBuiltInTheme(store, 'default-light');
    expect(activeTheme(store).fonts.heading).toBe(LIGHT.fonts.heading);
  });

  it('reset is one undo unit (undo restores the edited state)', () => {
    const store = new MemSlidesStore();
    applyBuiltInTheme(store, 'default-light');
    store.batch(() =>
      store.updateTheme('default-light', { colors: { accent1: '#abcdef' } }),
    );
    applyBuiltInTheme(store, 'default-light'); // reset
    expect(activeTheme(store).colors.accent1).toBe(LIGHT.colors.accent1);
    store.undo();
    expect(activeTheme(store).colors.accent1).toBe('#abcdef');
  });

  it('isThemeModified: false for pristine, true after edit', () => {
    const store = new MemSlidesStore();
    applyBuiltInTheme(store, 'material');
    expect(isThemeModified(activeTheme(store))).toBe(false);
    store.batch(() =>
      store.updateTheme('material', { colors: { accent1: '#000000' } }),
    );
    expect(isThemeModified(activeTheme(store))).toBe(true);
  });

  it('isThemeModified: false for a non-built-in (imported) theme', () => {
    expect(
      isThemeModified({
        id: 'imported-deck-theme',
        name: 'Imported',
        colors: LIGHT.colors,
        fonts: LIGHT.fonts,
      }),
    ).toBe(false);
  });
});
