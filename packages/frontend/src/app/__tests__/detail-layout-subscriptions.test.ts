import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');

/**
 * The three editor layouts that gained a `doc` handle when version history
 * was wired in (they need it to call `clearHistory()` after a restore).
 *
 * A bare `useDocument()` is `useSelector(store)` with no selector and
 * `Object.is` equality, and `@yorkie-js/react` rebuilds the whole state
 * object on every root change **and** every presence event. Subscribing a
 * *layout* to that re-renders `AppSidebar`, `SiteHeader`, `UserPresence` and
 * the toolbar tree on every keystroke and every peer cursor move — a cost
 * `board-view.tsx`'s `shouldPublish` gate ("a solo user waving the mouse
 * must not cost 60 React commits a second") was sized against the old set of
 * subscribers, before version history added a new one.
 *
 * The selector form reads only the `doc` handle, whose identity never
 * changes, so the layout re-renders on nothing. `useRevisions` in the SDK
 * does exactly the same.
 */
const LAYOUTS = [
  'board/board-detail.tsx',
  'notes/notes-detail.tsx',
  'slides/slides-detail.tsx',
];

describe('editor layout document subscriptions', () => {
  it.each(LAYOUTS)('%s subscribes through a selector, not the whole store', (file) => {
    const source = readFileSync(path.join(appDir, file), 'utf8');

    expect(
      source.includes('createDocumentSelector'),
      `${file} should build its hook with createDocumentSelector`,
    ).toBe(true);

    // Asserted on the import rather than the call site: a layout that does
    // not import the selectorless `useDocument` cannot call it, and an
    // import statement — unlike the identifier — never appears in the prose
    // comments that explain why this rule exists.
    expect(
      /import\s*\{[^}]*\buseDocument\b[^}]*\}\s*from\s*["']@yorkie-js\/react["']/.test(
        source,
      ),
      `${file} still imports the selectorless useDocument`,
    ).toBe(false);
  });
});
