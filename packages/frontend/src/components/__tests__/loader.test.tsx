import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Loader } from '../loader';

/**
 * jsdom has no layout engine — every `getBoundingClientRect()` here is a zero
 * rect — so these assert the *class contract* that produces the layout rather
 * than the layout itself. The geometry was measured in a real browser: before
 * this contract existed, the loader rendered 63px wide at x=256 inside a
 * 1016px-wide `PreviewSurface`, i.e. shrink-to-fit and pinned to the left.
 */
describe('Loader', () => {
  /**
   * The loader's own outermost box. Found by the `aria-live` region rather
   * than by `parentElement`, so adding a wrapper around the label can't
   * silently move the assertions onto the wrong node.
   */
  function root() {
    return screen.getByText('Loading…').closest('[aria-live]')!;
  }

  const has = (cls: string) => root().classList.contains(cls);

  // `flex-1` is `flex: 1 1 0%`, which fills the *main* axis of a flex parent
  // in either orientation: the width of the row-flex `PreviewSurface` every
  // editor's canvas sits in, and the height of a column-flex page body.
  // Without it the loader is shrink-to-fit on that axis —
  // `justify-content: flex-start` then parks it at the start edge while its
  // own `items-center` centres the spinner inside the collapsed box, which is
  // why the bug looked deliberate.
  it('fills the main axis of a flex parent in either orientation', () => {
    render(<Loader />);
    expect(has('flex-1')).toBe(true);
  });

  // `w-full` is redundant in every parent shape the app has today — see the
  // component's own comment. It is pinned anyway because it is the guard
  // against a parent that opts out of the cross-axis stretch
  // (`flex-col items-center`) reintroducing shrink-to-fit one axis over.
  it('keeps the cross-axis guard for a parent that opts out of stretch', () => {
    render(<Loader />);
    expect(has('w-full')).toBe(true);
  });

  // Filling the box is only half of it: the content has to be centred inside
  // the box it now fills.
  it('centres its content on both axes', () => {
    render(<Loader />);
    expect(has('items-center')).toBe(true);
    expect(has('justify-center')).toBe(true);
  });

  it('announces itself to a screen reader', () => {
    render(<Loader />);
    expect(root().getAttribute('aria-live')).toBe('polite');
  });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, '../..');

/** Every `.ts`/`.tsx`/`.css` file under `src`, tests excluded. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      sourceFiles(full, out);
      continue;
    }
    if (!/\.(tsx?|css)$/.test(entry.name)) continue;
    // A test is not user-visible, and this file has to be able to name the
    // spelling it forbids.
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

/**
 * Every user-visible loading label, so the app spells the word one way.
 *
 * It was previously spelled four ways at once, because each was written at
 * its own call site. The ASCII three-dot form is the one that drifts back in,
 * since it is what a keyboard types, so this scan is what keeps it out.
 *
 * Only the three-dot form is rejected: a real ellipsis inside a longer label
 * ("Loading PDF… 42%") is fine and deliberate.
 *
 * The dots must terminate the label itself — `Loading`, then only whole words
 * — rather than merely appear later on the line. A looser rule matches this
 * codebase's own vocabulary and reports lines that carry no label at all:
 * `const { isLoading, ...rest } = useQuery()` and `<LoadingOverlay {...p} />`
 * both contain `Loading` followed by `...`.
 */
const ASCII_ELLIPSIS_LABEL = /Loading(?: [A-Za-z]+)*\.\.\./;

describe('the loading label', () => {
  it('is spelled with an ellipsis character everywhere', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(srcDir)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (ASCII_ELLIPSIS_LABEL.test(line)) {
            offenders.push(`${path.relative(srcDir, file)}:${i + 1}`);
          }
        });
    }
    expect(offenders, 'use "…" rather than "..."').toEqual([]);
  });

  // The rule is only worth having if it still fires. Pinning both sides
  // keeps a later tightening from quietly turning it into a no-op.
  it('catches the ASCII form without catching React idioms', () => {
    expect(ASCII_ELLIPSIS_LABEL.test('<p>Loading...</p>')).toBe(true);
    expect(ASCII_ELLIPSIS_LABEL.test('<span>Loading rows...</span>')).toBe(true);
    expect(ASCII_ELLIPSIS_LABEL.test('title ?? "Loading..."')).toBe(true);
    expect(
      ASCII_ELLIPSIS_LABEL.test('const { isLoading, ...rest } = useQuery()'),
    ).toBe(false);
    expect(ASCII_ELLIPSIS_LABEL.test('<LoadingOverlay {...props} />')).toBe(
      false,
    );
  });
});
