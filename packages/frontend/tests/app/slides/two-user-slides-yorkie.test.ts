/**
 * Two-user convergence smoke test for theme mutations on
 * YorkieSlidesStore. Uses a single Yorkie Document with two store
 * instances pointing at it — sufficient for verifying that theme
 * additions and applyTheme writes propagate through the underlying
 * Yorkie root. Real two-client convergence (across separate Yorkie
 * Documents synced via the Yorkie server) lives in the
 * `yorkie-slides-concurrent.integration.ts` file.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import yorkie from '@yorkie-js/sdk';
import type { Document } from '@yorkie-js/sdk';
import type { Theme } from '@wafflebase/slides';
import {
  YorkieSlidesStore,
  ensureSlidesRoot,
} from '../../../src/app/slides/yorkie-slides-store.ts';
import type { YorkieSlidesRoot } from '../../../src/types/slides-document.ts';

function makeDoc(): Document<YorkieSlidesRoot> {
  const doc = new yorkie.Document<YorkieSlidesRoot>(
    `two-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  ensureSlidesRoot(doc);
  return doc;
}

function darkTheme(): Theme {
  return {
    id: 'dark',
    name: 'Dark',
    colors: {
      text: '#FFFFFF',
      background: '#202124',
      textSecondary: '#9AA0A6',
      backgroundAlt: '#3C4043',
      accent1: '#8AB4F8',
      accent2: '#81C995',
      accent3: '#FDD663',
      accent4: '#F28B82',
      accent5: '#C58AF9',
      accent6: '#FCAD70',
      hyperlink: '#8AB4F8',
      visitedHyperlink: '#C58AF9',
    },
    fonts: { heading: 'Inter', body: 'Inter' },
  };
}

describe('YorkieSlidesStore — addTheme / applyTheme convergence', () => {
  it('two stores on the same Yorkie doc both see the new themeId after applyTheme', () => {
    const doc = makeDoc();
    const storeA = new YorkieSlidesStore(doc);
    const storeB = new YorkieSlidesStore(doc);

    // Both start with the default-light theme as the active theme.
    assert.equal(storeA.read().meta.themeId, 'default-light');
    assert.equal(storeB.read().meta.themeId, 'default-light');

    // User A pushes a new theme into the document.
    const dark = darkTheme();
    storeA.batch(() => storeA.addTheme(dark));

    // Both stores now see the new theme in themes[].
    assert.ok(storeA.read().themes.find((t) => t.id === 'dark'));
    assert.ok(storeB.read().themes.find((t) => t.id === 'dark'));

    // User A applies the new theme as the active theme.
    storeA.batch(() => storeA.applyTheme('dark'));

    // Both stores converge on the new themeId.
    assert.equal(storeA.read().meta.themeId, 'dark');
    assert.equal(storeB.read().meta.themeId, 'dark');
  });

  it('addTheme is idempotent on theme.id', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    const dark = darkTheme();
    store.batch(() => {
      store.addTheme(dark);
      store.addTheme(dark);
      store.addTheme({ ...dark, name: 'Dark (renamed)' });
    });
    const themes = store.read().themes;
    const darkThemes = themes.filter((t) => t.id === 'dark');
    assert.equal(darkThemes.length, 1);
    // First write wins — subsequent same-id calls are no-ops.
    assert.equal(darkThemes[0].name, 'Dark');
  });

  it('applyTheme throws when the theme is not in themes[]', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    assert.throws(
      () => store.batch(() => store.applyTheme('does-not-exist')),
      /not in document/,
    );
  });
});
