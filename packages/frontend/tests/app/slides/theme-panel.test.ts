import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BUILT_IN_THEMES, MemSlidesStore } from '@wafflebase/slides';
import { applyBuiltInTheme } from '@/app/slides/theme-panel-helpers.ts';

/**
 * The theme panel itself is a React component rendered in the browser
 * bundle. The frontend test runner uses Node's
 * `--experimental-strip-types`, which can't parse JSX — `.tsx` files
 * are stubbed by `tests/resolve-hooks.mjs`. So the panel's
 * behaviour-under-test (the batched addTheme + applyTheme call wired
 * to each thumbnail) is extracted into `applyBuiltInTheme` and tested
 * here against MemSlidesStore directly.
 *
 * MemSlidesStore and YorkieSlidesStore implement the same SlidesStore
 * interface; the equivalence test
 * (`yorkie-slides-equivalence.test.ts`) covers the Yorkie path, so
 * exercising the helper through MemSlidesStore is enough for theme
 * panel coverage.
 */

describe('ThemePanel — applyBuiltInTheme helper', () => {
  it('exposes exactly five built-in themes (panel surface contract)', () => {
    // The panel renders one thumbnail per built-in theme, so the count
    // here is the same number the user sees in the picker. If a future
    // PR adds/removes a theme, this test fails as a forcing function
    // to update the panel snapshot/screenshot in the same change.
    assert.equal(BUILT_IN_THEMES.length, 5);
    assert.deepEqual(
      BUILT_IN_THEMES.map((t) => t.id),
      ['default-light', 'default-dark', 'streamline', 'focus', 'material'],
    );
  });

  it('applying a built-in theme sets meta.themeId', () => {
    const store = new MemSlidesStore();
    assert.equal(store.read().meta.themeId, 'default-light');
    applyBuiltInTheme(store, 'material');
    assert.equal(store.read().meta.themeId, 'material');
  });

  it('addTheme + applyTheme are batched into one undo entry', () => {
    const store = new MemSlidesStore();
    applyBuiltInTheme(store, 'focus');
    assert.equal(store.read().meta.themeId, 'focus');
    // Single undo should revert BOTH the addTheme and the applyTheme,
    // not just one of them — proving they share a batch.
    assert.ok(store.canUndo());
    store.undo();
    assert.equal(store.read().meta.themeId, 'default-light');
    // Theme list also reverted (back to just the seed default-light).
    assert.deepEqual(
      store.read().themes.map((t) => t.id),
      ['default-light'],
    );
  });

  it('applying an already-active theme is idempotent on themes[]', () => {
    const store = new MemSlidesStore();
    applyBuiltInTheme(store, 'streamline');
    applyBuiltInTheme(store, 'streamline');
    const themes = store.read().themes;
    // 'streamline' should appear exactly once even though we applied it twice
    assert.equal(themes.filter((t) => t.id === 'streamline').length, 1);
  });

  it('throws on unknown built-in theme id', () => {
    const store = new MemSlidesStore();
    assert.throws(
      () => applyBuiltInTheme(store, 'no-such-theme'),
      /unknown built-in theme/,
    );
  });

  it('every BUILT_IN_THEME applies cleanly through the helper', () => {
    // Smoke-fence against future themes that are missing required
    // colors/fonts and would break addTheme/applyTheme.
    for (const t of BUILT_IN_THEMES) {
      const store = new MemSlidesStore();
      applyBuiltInTheme(store, t.id);
      assert.equal(store.read().meta.themeId, t.id);
    }
  });
});
