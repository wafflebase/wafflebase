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
  /** The `aria-live` region is the loader's own outermost box. */
  function root() {
    return screen.getByText('Loading…').parentElement!;
  }

  // A row-flex parent (`PreviewSurface`, which every editor's canvas sits in)
  // sizes an item by its content on the main axis. Without `w-full` the
  // loader collapses to the spinner's width and `justify-content: flex-start`
  // parks it at the left edge; its own `items-center` then centres the
  // spinner inside that collapsed box, which is why it looked deliberate.
  it('fills the cross axis of a row-flex parent', () => {
    render(<Loader />);
    expect(root().className).toContain('w-full');
  });

  // And a column-flex parent (`document-detail`'s grid column, the mobile
  // slides shell) sizes an item by its content on the *vertical* axis, so the
  // same collapse happens one axis over: without `flex-1` the loader is a
  // 300px box at the top of a full-height column.
  it('fills the main axis of a column-flex parent', () => {
    render(<Loader />);
    expect(root().className).toContain('flex-1');
  });

  // Both together are what let a call site render `<Loader />` bare. Losing
  // either one silently returns one axis to shrink-to-fit, and the call sites
  // no longer carry a centring wrapper that would hide it.
  it('centres its content on both axes', () => {
    render(<Loader />);
    expect(root().className).toContain('items-center');
    expect(root().className).toContain('justify-center');
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
 */
describe('the loading label', () => {
  it('is spelled with an ellipsis character everywhere', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(srcDir)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/Loading[^\n]*\.\.\./.test(line)) {
            offenders.push(`${path.relative(srcDir, file)}:${i + 1}`);
          }
        });
    }
    expect(offenders, 'use "…" rather than "..."').toEqual([]);
  });
});
